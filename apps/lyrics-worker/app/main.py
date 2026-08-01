import json
import math
import os
import shutil
import sys
import threading
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI
from partyroom_activity_worker import ActivityContext, Worker, replace_url_origin

from .activities_generated import (
    AlignLyricsInput,
    AlignLyricsOutput,
    TranscribeInput,
    TranscribeOutput,
    align_lyrics,
    transcribe,
)
from .chunked import (
    TranscriptionCancelled,
    cleanup_stale_work,
    transcribe_audio_chunks,
    write_text_atomic,
)
from .settings import positive_int_setting
from .structured import TimedLyric, build_timed_lyrics
from .transcriber import create_transcriber
from .webvtt import build_webvtt


WORK_DIR = Path(os.getenv("WORK_DIR", "/work"))
ASR_MODEL = os.getenv("LYRICS_ASR_MODEL", "Qwen/Qwen3-ASR-0.6B")
ALIGNER_MODEL = os.getenv("LYRICS_ALIGNER_MODEL", "Qwen/Qwen3-ForcedAligner-0.6B")
MAX_BYTES = int(os.getenv("MAX_MEDIA_BYTES", str(2 * 1024 * 1024 * 1024)))
MAX_NEW_TOKENS = positive_int_setting("LYRICS_MAX_NEW_TOKENS", 1024)
CHUNK_SECONDS = positive_int_setting("LYRICS_CHUNK_SECONDS", 60)
API_URL = os.environ["ACTIVITY_WORKER_API_URL"].rstrip("/") + "/"
TOKEN = os.environ["ACTIVITY_WORKER_TOKEN"]
ARTIFACT_ORIGIN = os.getenv("ACTIVITY_ARTIFACT_ORIGIN")
LYRICS_BACKEND = os.getenv("LYRICS_BACKEND", "pytorch")
model: Any = None
model_lock = threading.Lock()
PROGRESS_PREFIX = "partyroom-progress:"

worker = Worker(
    api_url=API_URL,
    token=TOKEN,
    worker_id=os.getenv("ACTIVITY_WORKER_ID", "lyrics-worker"),
    task_queue="lyrics",
    max_concurrent_activities=int(os.getenv("LYRICS_WORKER_CONCURRENCY", "1")),
    artifact_origin=ARTIFACT_ORIGIN,
)


async def download(
    url: str,
    destination: Path,
    on_progress: Callable[[int, int], Awaitable[None]] | None = None,
) -> None:
    size = 0
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(60, read=600), follow_redirects=True
    ) as client:
        artifact_url = (
            replace_url_origin(url, ARTIFACT_ORIGIN) if ARTIFACT_ORIGIN else url
        )
        async with client.stream("GET", artifact_url) as response:
            response.raise_for_status()
            declared_size = int(response.headers.get("content-length", "0"))
            if declared_size > MAX_BYTES:
                raise ValueError("Input exceeds MAX_MEDIA_BYTES")
            if on_progress is not None:
                await on_progress(0, declared_size)
            with destination.open("wb") as output:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise ValueError("Input exceeds MAX_MEDIA_BYTES")
                    output.write(chunk)
                    if on_progress is not None:
                        await on_progress(size, declared_size)


def get_model() -> Any:
    global model
    if model is not None:
        return model
    with model_lock:
        if model is not None:
            return model
        model = create_transcriber(
            LYRICS_BACKEND,
            asr_model=ASR_MODEL,
            aligner_model=ALIGNER_MODEL,
            max_new_tokens=MAX_NEW_TOKENS,
        )
        return model


def load_mono_audio(audio_path: Path) -> tuple[Any, int]:
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly

    audio, sample_rate = sf.read(audio_path, dtype="float32", always_2d=True)
    mono = np.mean(audio, axis=1, dtype=np.float32)
    del audio
    target_sample_rate = 16_000
    if sample_rate != target_sample_rate:
        divisor = math.gcd(sample_rate, target_sample_rate)
        mono = resample_poly(
            mono,
            target_sample_rate // divisor,
            sample_rate // divisor,
        ).astype(np.float32, copy=False)
    return mono, target_sample_rate


def transcribe_to_artifacts(
    audio_path: Path,
    vtt_path: Path,
    lyrics_path: Path,
    cancelled: threading.Event,
    chunk_completed: Callable[[int, int], None] | None = None,
    stage_changed: Callable[[str], None] | None = None,
) -> str | None:
    if stage_changed is not None:
        stage_changed("preprocessing")
    mono, target_sample_rate = load_mono_audio(audio_path)

    if stage_changed is not None:
        stage_changed("loadingModel")
    loaded_model = get_model()
    if stage_changed is not None:
        stage_changed("transcribing")
    language, words = transcribe_audio_chunks(
        loaded_model,
        mono,
        sample_rate=target_sample_rate,
        chunk_seconds=CHUNK_SECONDS,
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
            asr_model=ASR_MODEL,
            aligner_model=ALIGNER_MODEL,
        ),
    )
    return language


def align_to_artifact(
    audio_path: Path,
    lyrics_path: Path,
    transcript: str,
    language: str,
    cancelled: threading.Event,
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
        stage_changed("loadingModel")
    loaded_model = get_model()
    if stage_changed is not None:
        stage_changed("aligning")
    words = loaded_model.align(
        audio=(mono, sample_rate),
        text=transcript,
        language=language,
    )
    if cancelled.is_set():
        raise TranscriptionCancelled("Lyrics alignment was cancelled")
    if not words:
        raise ValueError("Qwen forced alignment returned no words")
    if stage_changed is not None:
        stage_changed("writing")
    write_text_atomic(
        lyrics_path,
        build_timed_lyrics(
            [
                TimedLyric(
                    time=float(word.start_time),
                    duration=float(word.end_time) - float(word.start_time),
                    value=str(word.text),
                )
                for word in words
            ],
            language=language,
            asr_model="LRCLIB",
            aligner_model=ALIGNER_MODEL,
        ),
    )


async def run_transcription(
    context: ActivityContext, input_path: Path, vtt_path: Path, lyrics_path: Path
) -> str | None:
    result_path = lyrics_path.with_name("transcription-result.json")

    async def process_output(line: str) -> None:
        if not line.startswith(PROGRESS_PREFIX):
            return
        progress = json.loads(line[len(PROGRESS_PREFIX) :])
        stage = progress.get("stage")
        if stage == "preprocessing":
            await context.report_progress(0.25, "Preparing vocal audio")
            return
        if stage == "loadingModel":
            await context.report_progress(0.375, f"Loading {ASR_MODEL}")
            return
        if stage == "transcribing":
            await context.report_progress(
                0.5, f"Transcribing and aligning with {ASR_MODEL}"
            )
            return
        if stage == "writing":
            await context.report_progress(0.75, "Writing timed lyric artifacts")
            return
        completed = int(progress["completed"])
        total = int(progress["total"])
        await context.report_progress(
            0.5 + 0.25 * completed / total,
            f"Transcribed and aligned chunk {completed} of {total}",
        )

    await context.run_process(
        sys.executable,
        "-m",
        "app.transcription_process",
        str(input_path),
        str(vtt_path),
        str(lyrics_path),
        str(result_path),
        on_stdout_line=process_output,
    )
    return json.loads(result_path.read_text(encoding="utf-8")).get("language")


async def run_alignment(
    context: ActivityContext,
    input_path: Path,
    transcript_path: Path,
    lyrics_path: Path,
    language: str,
) -> None:
    async def process_output(line: str) -> None:
        if not line.startswith(PROGRESS_PREFIX):
            return
        stage = json.loads(line[len(PROGRESS_PREFIX) :]).get("stage")
        if stage == "preprocessing":
            await context.report_progress(0.25, "Preparing vocal audio")
        elif stage == "loadingModel":
            await context.report_progress(0.4, f"Loading {ALIGNER_MODEL}")
        elif stage == "aligning":
            await context.report_progress(0.55, "Aligning LRCLIB lyrics")
        elif stage == "writing":
            await context.report_progress(0.75, "Writing word-timed lyrics")

    await context.run_process(
        sys.executable,
        "-m",
        "app.alignment_process",
        str(input_path),
        str(transcript_path),
        str(lyrics_path),
        language,
        on_stdout_line=process_output,
    )


@worker.activity(transcribe)
async def transcribe_activity(context: ActivityContext, activity: TranscribeInput) -> TranscribeOutput:
    directory = WORK_DIR / f"{context.info.activity_id}-{context.info.attempt}"
    input_path = directory / "vocals.flac"
    vtt_path = directory / "lyrics.vtt"
    lyrics_path = directory / "timed-lyrics.json"
    directory.mkdir(parents=True, exist_ok=True)
    try:
        await context.report_progress(0, "Downloading vocal stem")
        await download(
            activity.audio_url,
            input_path,
            context.progress_reporter(0, 0.25, "Downloading vocal stem"),
        )
        await context.report_progress(0.25, "Preparing transcription")
        language = await run_transcription(context, input_path, vtt_path, lyrics_path)
        await context.report_progress(0.75, "Uploading timed lyric artifacts")
        if vtt_path.stat().st_size > MAX_BYTES or lyrics_path.stat().st_size > MAX_BYTES:
            raise ValueError("Output exceeds MAX_MEDIA_BYTES")
        lyrics_artifact_id = await context.upload_artifact(
            "lyricsArtifactId",
            vtt_path,
            "text/vtt",
            on_progress=context.progress_reporter(
                0.75, 0.875, "Uploading WebVTT lyrics"
            ),
        )
        timed_lyrics_artifact_id = await context.upload_artifact(
            "timedLyricsArtifactId",
            lyrics_path,
            "application/json",
            on_progress=context.progress_reporter(
                0.875, 1, "Uploading timed lyric data"
            ),
        )
        return TranscribeOutput(
            lyrics_artifact_id=lyrics_artifact_id,
            timed_lyrics_artifact_id=timed_lyrics_artifact_id,
            content_type="text/vtt", model=ASR_MODEL, language=language,
        )
    finally:
        shutil.rmtree(directory, ignore_errors=True)


@worker.activity(align_lyrics)
async def align_lyrics_activity(
    context: ActivityContext,
    activity: AlignLyricsInput,
) -> AlignLyricsOutput:
    directory = WORK_DIR / f"{context.info.activity_id}-{context.info.attempt}"
    input_path = directory / "vocals.flac"
    transcript_path = directory / "lrclib.txt"
    lyrics_path = directory / "timed-lyrics.json"
    directory.mkdir(parents=True, exist_ok=True)
    try:
        await context.report_progress(0, "Downloading vocal stem")
        await download(
            activity.audio_url,
            input_path,
            context.progress_reporter(0, 0.25, "Downloading vocal stem"),
        )
        write_text_atomic(transcript_path, activity.lyrics)
        await run_alignment(
            context,
            input_path,
            transcript_path,
            lyrics_path,
            activity.language,
        )
        await context.report_progress(0.75, "Uploading aligned LRCLIB lyrics")
        if lyrics_path.stat().st_size > MAX_BYTES:
            raise ValueError("Output exceeds MAX_MEDIA_BYTES")
        timed_lyrics_artifact_id = await context.upload_artifact(
            "timedLyricsArtifactId",
            lyrics_path,
            "application/json",
            on_progress=context.progress_reporter(
                0.75, 1, "Uploading word-timed LRCLIB lyrics"
            ),
        )
        return AlignLyricsOutput(
            timed_lyrics_artifact_id=timed_lyrics_artifact_id,
            content_type="application/json",
            model=ALIGNER_MODEL,
            language=activity.language,
        )
    finally:
        shutil.rmtree(directory, ignore_errors=True)


if os.getenv("LYRICS_PROCESS_CHILD") != "1":
    cleanup_stale_work(WORK_DIR)
app = FastAPI(title="Partyroom lyrics worker", lifespan=worker.lifespan)


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        **worker.health(),
        "model": ASR_MODEL,
        "aligner": ALIGNER_MODEL,
        "maxNewTokens": MAX_NEW_TOKENS,
        "chunkSeconds": CHUNK_SECONDS,
        "modelLoaded": model is not None,
        "backend": LYRICS_BACKEND,
        "inferenceMode": "managed-process",
    }
