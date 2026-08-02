import math
import re
import threading
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

from .aligner import AlignedWord, ForcedAligner
from .audio import load_mono_audio
from .chunked import TranscriptionCancelled, write_text_atomic
from .structured import TimedLyric, build_timed_lyrics

MAX_ALIGNMENT_SECONDS = 300
CORE_ALIGNMENT_SECONDS = 240
AUDIO_CONTEXT_SECONDS = 10
MAX_LINE_AUDIO_SECONDS = 30


@dataclass(frozen=True)
class AlignmentLine:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class AlignmentChunk:
    context_start: int
    context_end: int
    core_start: int
    core_end: int
    audio_start: float
    audio_end: float


def alignment_lines_from_arrays(
    texts: list[str],
    starts: list[float],
    ends: list[float],
) -> list[AlignmentLine]:
    if len(texts) != len(starts) or len(texts) != len(ends):
        raise ValueError("Lyric line text and timing arrays must have equal lengths")
    lines: list[AlignmentLine] = []
    for text, start, end in zip(texts, starts, ends):
        normalized = text.strip()
        if not normalized:
            raise ValueError("Lyrics contain an empty line")
        if (
            not math.isfinite(start)
            or not math.isfinite(end)
            or start < 0
            or end <= start
        ):
            raise ValueError("Lyrics contain invalid line timing")
        if lines and start < lines[-1].start:
            raise ValueError("Lyric lines must be ordered by start time")
        lines.append(AlignmentLine(text=normalized, start=start, end=end))
    if not lines:
        raise ValueError("Lyrics transcript is empty")
    return lines


def _effective_line_end(line: AlignmentLine) -> float:
    return min(line.end, line.start + MAX_LINE_AUDIO_SECONDS)


def _audio_window(
    lines: list[AlignmentLine],
    start: int,
    end: int,
    audio_duration: float,
) -> tuple[float, float]:
    audio_start = max(0.0, lines[start].start - AUDIO_CONTEXT_SECONDS)
    audio_end = min(
        audio_duration,
        max(_effective_line_end(line) for line in lines[start:end])
        + AUDIO_CONTEXT_SECONDS,
    )
    return audio_start, audio_end


def build_alignment_chunks(
    lines: list[AlignmentLine],
    audio_duration: float,
) -> list[AlignmentChunk]:
    if not math.isfinite(audio_duration) or audio_duration <= 0:
        raise ValueError("Lyrics alignment audio is empty")

    chunks: list[AlignmentChunk] = []
    core_start = 0
    while core_start < len(lines):
        core_end = core_start + 1
        while (
            core_end < len(lines)
            and lines[core_end].start - lines[core_start].start
            <= CORE_ALIGNMENT_SECONDS
        ):
            core_end += 1

        context_start = core_start
        context_end = core_end
        if context_start > 0:
            candidate_start = context_start - 1
            audio_start, audio_end = _audio_window(
                lines,
                candidate_start,
                context_end,
                audio_duration,
            )
            if 0 < audio_end - audio_start <= MAX_ALIGNMENT_SECONDS:
                context_start = candidate_start
        if context_end < len(lines):
            candidate_end = context_end + 1
            audio_start, audio_end = _audio_window(
                lines,
                context_start,
                candidate_end,
                audio_duration,
            )
            if 0 < audio_end - audio_start <= MAX_ALIGNMENT_SECONDS:
                context_end = candidate_end

        audio_start, audio_end = _audio_window(
            lines,
            context_start,
            context_end,
            audio_duration,
        )
        if audio_end <= audio_start:
            raise ValueError("Lyric line timing falls outside the available audio")
        if audio_end - audio_start > MAX_ALIGNMENT_SECONDS:
            raise ValueError("Unable to fit a lyric line into a forced-alignment chunk")
        chunks.append(
            AlignmentChunk(
                context_start=context_start,
                context_end=context_end,
                core_start=core_start,
                core_end=core_end,
                audio_start=audio_start,
                audio_end=audio_end,
            )
        )
        core_start = core_end
    return chunks


def _source_tokens(transcript: str) -> list[str]:
    return re.findall(r"\S+", transcript)


def _normalized_characters(value: str) -> str:
    return "".join(
        character.casefold()
        for character in unicodedata.normalize("NFKC", value)
        if character == "'" or character.isalnum()
    )


def _character_spans(tokens: list[str]) -> tuple[str, list[tuple[int, int]]]:
    text = ""
    spans: list[tuple[int, int]] = []
    for token in tokens:
        start = len(text)
        text += _normalized_characters(token)
        spans.append((start, len(text)))
    return text, spans


def _matching_aligned_indices(
    source_tokens: list[str],
    aligned_words: list[AlignedWord],
) -> list[set[int]]:
    source_text, source_spans = _character_spans(source_tokens)
    aligned_text, aligned_spans = _character_spans(
        [word.text for word in aligned_words]
    )
    matches = [set() for _ in source_tokens]
    matched_characters = [set() for _ in source_tokens]
    if not source_text or not aligned_text:
        return matches

    matcher = SequenceMatcher(None, source_text, aligned_text, autojunk=False)
    for block in matcher.get_matching_blocks():
        if block.size == 0:
            continue
        source_start = block.a
        source_end = block.a + block.size
        aligned_start = block.b
        aligned_end = block.b + block.size
        for source_index, (token_start, token_end) in enumerate(source_spans):
            overlap_start = max(token_start, source_start)
            overlap_end = min(token_end, source_end)
            if overlap_start >= overlap_end:
                continue
            corresponding_start = aligned_start + overlap_start - source_start
            corresponding_end = aligned_start + overlap_end - source_start
            matched_characters[source_index].update(range(overlap_start, overlap_end))
            for aligned_index, (word_start, word_end) in enumerate(aligned_spans):
                if (
                    word_start < corresponding_end
                    and word_end > corresponding_start
                ):
                    matches[source_index].add(aligned_index)
    for index, (token_start, token_end) in enumerate(source_spans):
        token_length = token_end - token_start
        if token_length and len(matched_characters[index]) * 2 < token_length:
            matches[index].clear()
    return matches


def _estimated_duration(words: list[AlignedWord]) -> float:
    durations = sorted(
        word.end_time - word.start_time
        for word in words
        if math.isfinite(word.start_time)
        and math.isfinite(word.end_time)
        and word.end_time > word.start_time
    )
    if not durations:
        return 0.1
    middle = len(durations) // 2
    return (
        durations[middle]
        if len(durations) % 2
        else (durations[middle - 1] + durations[middle]) / 2
    )


def preserve_transcript_timing(
    transcript: str,
    aligned_words: list[AlignedWord],
) -> list[TimedLyric]:
    """Use aligner timing as evidence without allowing it to rewrite the transcript."""
    source_tokens = _source_tokens(transcript)
    if not source_tokens:
        raise ValueError("Lyrics transcript is empty")
    if not aligned_words:
        raise ValueError("Qwen forced alignment returned no words")

    matches = _matching_aligned_indices(source_tokens, aligned_words)
    ranges: list[tuple[float, float] | None] = []
    for indices in matches:
        finite_words = [
            aligned_words[index]
            for index in sorted(indices)
            if math.isfinite(aligned_words[index].start_time)
            and math.isfinite(aligned_words[index].end_time)
        ]
        ranges.append(
            (
                min(word.start_time for word in finite_words),
                max(word.end_time for word in finite_words),
            )
            if finite_words
            else None
        )
    if not any(span is not None for span in ranges):
        raise ValueError("Qwen forced alignment did not match the submitted transcript")

    estimate = max(0.01, _estimated_duration(aligned_words))
    starts: list[float | None] = [
        max(0.0, span[0]) if span is not None else None for span in ranges
    ]
    for index, start in enumerate(starts):
        if start is not None:
            continue
        previous = next(
            (
                starts[candidate]
                for candidate in range(index - 1, -1, -1)
                if starts[candidate] is not None
            ),
            None,
        )
        following_index = next(
            (
                candidate
                for candidate in range(index + 1, len(starts))
                if starts[candidate] is not None
            ),
            None,
        )
        following = starts[following_index] if following_index is not None else None
        if previous is not None and following is not None:
            missing_count = following_index - index + 1
            start = previous + (following - previous) / missing_count
        elif previous is not None:
            start = previous + estimate
        else:
            start = max(0.0, following - estimate * (following_index - index))
        starts[index] = start

    concrete_starts = [float(start) for start in starts]
    for index in range(1, len(concrete_starts)):
        concrete_starts[index] = max(concrete_starts[index], concrete_starts[index - 1])

    lyrics: list[TimedLyric] = []
    for index, (token, start) in enumerate(zip(source_tokens, concrete_starts)):
        aligned_end = ranges[index][1] if ranges[index] is not None else start
        next_start = (
            concrete_starts[index + 1]
            if index + 1 < len(concrete_starts)
            else None
        )
        end = max(start, aligned_end)
        if end <= start:
            end = (
                next_start
                if next_start is not None and next_start > start
                else start + estimate
            )
        lyrics.append(
            TimedLyric(
                time=start,
                duration=max(0.01, end - start),
                value=token,
            )
        )
    return lyrics


def align_to_artifact(
    audio_path: Path,
    lyrics_path: Path,
    lines: list[AlignmentLine],
    language: str,
    cancelled: threading.Event,
    *,
    aligner: ForcedAligner,
    aligner_model: str,
    chunk_completed: Callable[[int, int], None] | None = None,
    stage_changed: Callable[[str], None] | None = None,
) -> None:
    if not lines:
        raise ValueError("Lyrics transcript is empty")
    if stage_changed is not None:
        stage_changed("preprocessing")
    mono, sample_rate = load_mono_audio(audio_path)
    chunks = build_alignment_chunks(lines, len(mono) / sample_rate)
    if cancelled.is_set():
        raise TranscriptionCancelled("Lyrics alignment was cancelled")
    if stage_changed is not None:
        stage_changed("aligning")

    timed_lyrics: list[TimedLyric] = []
    for chunk_index, chunk in enumerate(chunks):
        if cancelled.is_set():
            raise TranscriptionCancelled("Lyrics alignment was cancelled")
        start_sample = max(0, math.floor(chunk.audio_start * sample_rate))
        end_sample = min(
            len(mono),
            math.ceil(chunk.audio_end * sample_rate),
            start_sample + MAX_ALIGNMENT_SECONDS * sample_rate,
        )
        audio_offset = start_sample / sample_rate
        transcript = "\n".join(
            line.text for line in lines[chunk.context_start : chunk.context_end]
        )
        words = aligner.align(
            audio=(mono[start_sample:end_sample], sample_rate),
            text=transcript,
            language=language,
        )
        if cancelled.is_set():
            raise TranscriptionCancelled("Lyrics alignment was cancelled")
        aligned = preserve_transcript_timing(transcript, words)
        owned_start = sum(
            len(_source_tokens(line.text))
            for line in lines[chunk.context_start : chunk.core_start]
        )
        owned_count = sum(
            len(_source_tokens(line.text))
            for line in lines[chunk.core_start : chunk.core_end]
        )
        timed_lyrics.extend(
            TimedLyric(
                time=word.time + audio_offset,
                duration=word.duration,
                value=word.value,
            )
            for word in aligned[owned_start : owned_start + owned_count]
        )
        if chunk_completed is not None:
            chunk_completed(chunk_index + 1, len(chunks))

    monotonic_lyrics: list[TimedLyric] = []
    for word in timed_lyrics:
        time = max(word.time, monotonic_lyrics[-1].time if monotonic_lyrics else 0.0)
        monotonic_lyrics.append(
            TimedLyric(
                time=time,
                duration=max(0.01, word.duration),
                value=word.value,
            )
        )
    if stage_changed is not None:
        stage_changed("writing")
    write_text_atomic(
        lyrics_path,
        build_timed_lyrics(
            monotonic_lyrics,
            language=language,
            asr_model="provided-transcript",
            aligner_model=aligner_model,
        ),
    )
