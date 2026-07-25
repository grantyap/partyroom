import gc
import math
import os
import shutil
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

from .webvtt import TimedWord


class TranscriptionCancelled(Exception):
    pass


def transcribe_audio_chunks(
    model: Any,
    audio: np.ndarray,
    *,
    sample_rate: int,
    chunk_seconds: int,
    cancelled: threading.Event,
    chunk_completed: Callable[[int, int], None] | None = None,
) -> tuple[str | None, list[TimedWord]]:
    if audio.ndim != 1:
        raise ValueError("Expected mono audio")
    samples_per_chunk = sample_rate * chunk_seconds
    total_chunks = max(1, math.ceil(len(audio) / samples_per_chunk))
    language: str | None = None
    words: list[TimedWord] = []

    for chunk_index, start_sample in enumerate(
        range(0, max(1, len(audio)), samples_per_chunk)
    ):
        if cancelled.is_set():
            raise TranscriptionCancelled("Transcription was cancelled")
        chunk = audio[start_sample : start_sample + samples_per_chunk]
        result = model.transcribe(
            audio=(chunk, sample_rate),
            language=language,
            return_time_stamps=True,
        )[0]
        if cancelled.is_set():
            raise TranscriptionCancelled("Transcription was cancelled")

        offset = start_sample / sample_rate
        words.extend(
            TimedWord(
                text=str(getattr(item, "text", "")),
                start=offset + float(getattr(item, "start_time", 0)),
                end=offset + float(getattr(item, "end_time", 0)),
            )
            for item in (result.time_stamps or [])
        )
        if result.language:
            language = str(result.language)
        if chunk_completed is not None:
            chunk_completed(chunk_index + 1, total_chunks)

        del result, chunk
        gc.collect()

    return language, words


def write_text_atomic(path: Path, content: str) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        temporary.write_text(content, encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def cleanup_stale_work(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    for entry in root.iterdir():
        if entry.is_dir() and not entry.is_symlink():
            shutil.rmtree(entry, ignore_errors=True)
        else:
            entry.unlink(missing_ok=True)
