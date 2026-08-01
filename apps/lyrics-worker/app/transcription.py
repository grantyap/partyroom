import threading
from collections.abc import Callable
from pathlib import Path

from .audio import load_mono_audio
from .chunked import (
    TranscriptionCancelled,
    transcribe_audio_chunks,
    write_text_atomic,
)
from .structured import TimedLyric, build_timed_lyrics
from .transcriber import Transcriber
from .webvtt import build_webvtt


def transcribe_to_artifacts(
    audio_path: Path,
    vtt_path: Path,
    lyrics_path: Path,
    cancelled: threading.Event,
    *,
    transcriber: Transcriber,
    asr_model: str,
    aligner_model: str,
    chunk_seconds: int,
    chunk_completed: Callable[[int, int], None] | None = None,
    stage_changed: Callable[[str], None] | None = None,
) -> str | None:
    if stage_changed is not None:
        stage_changed("preprocessing")
    mono, target_sample_rate = load_mono_audio(audio_path)

    if stage_changed is not None:
        stage_changed("transcribing")
    language, words = transcribe_audio_chunks(
        transcriber,
        mono,
        sample_rate=target_sample_rate,
        chunk_seconds=chunk_seconds,
        cancelled=cancelled,
        chunk_completed=chunk_completed,
    )
    if cancelled.is_set():
        raise TranscriptionCancelled("Transcription was cancelled")
    if stage_changed is not None:
        stage_changed("writing")
    write_text_atomic(vtt_path, build_webvtt(words, language))
    write_text_atomic(
        lyrics_path,
        build_timed_lyrics(
            [
                TimedLyric(
                    time=word.start,
                    duration=word.end - word.start,
                    value=word.text,
                )
                for word in words
            ],
            language=language,
            asr_model=asr_model,
            aligner_model=aligner_model,
        ),
    )
    return language
