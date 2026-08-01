import math
import re
import threading
import unicodedata
from collections.abc import Callable
from difflib import SequenceMatcher
from pathlib import Path

from .aligner import AlignedWord, ForcedAligner
from .audio import load_mono_audio
from .chunked import TranscriptionCancelled, write_text_atomic
from .structured import TimedLyric, build_timed_lyrics


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
    transcript: str,
    language: str,
    cancelled: threading.Event,
    *,
    aligner: ForcedAligner,
    aligner_model: str,
    stage_changed: Callable[[str], None] | None = None,
) -> None:
    if not transcript.strip():
        raise ValueError("Lyrics transcript is empty")
    if stage_changed is not None:
        stage_changed("preprocessing")
    mono, sample_rate = load_mono_audio(audio_path)
    if len(mono) / sample_rate > 300:
        raise ValueError("Qwen forced alignment supports at most 5 minutes of audio")
    if cancelled.is_set():
        raise TranscriptionCancelled("Lyrics alignment was cancelled")
    if stage_changed is not None:
        stage_changed("aligning")
    words = aligner.align(
        audio=(mono, sample_rate),
        text=transcript,
        language=language,
    )
    if cancelled.is_set():
        raise TranscriptionCancelled("Lyrics alignment was cancelled")
    timed_lyrics = preserve_transcript_timing(transcript, words)
    if stage_changed is not None:
        stage_changed("writing")
    write_text_atomic(
        lyrics_path,
        build_timed_lyrics(
            timed_lyrics,
            language=language,
            asr_model="provided-transcript",
            aligner_model=aligner_model,
        ),
    )
