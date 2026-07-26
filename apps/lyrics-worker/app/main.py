import json
import math
import os
import shutil
import sys
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI
from partyroom_activity_worker import ActivityContext, Worker

from .activities_generated import TranscribeInput, TranscribeOutput, transcribe
from .chunked import (
    TranscriptionCancelled,
    cleanup_stale_work,
    transcribe_audio_chunks,
    write_text_atomic,
)
from .settings import positive_int_setting
from .structured import TimedLyric, build_timed_lyrics
from .webvtt import TimedWord, build_webvtt


WORK_DIR = Path(os.getenv("WORK_DIR", "/work"))
ASR_MODEL = os.getenv("LYRICS_ASR_MODEL", "Qwen/Qwen3-ASR-0.6B")
ALIGNER_MODEL = os.getenv("LYRICS_ALIGNER_MODEL", "Qwen/Qwen3-ForcedAligner-0.6B")
MAX_BYTES = int(os.getenv("MAX_MEDIA_BYTES", str(2 * 1024 * 1024 * 1024)))
MAX_NEW_TOKENS = positive_int_setting("LYRICS_MAX_NEW_TOKENS", 1024)
CHUNK_SECONDS = positive_int_setting("LYRICS_CHUNK_SECONDS", 60)
API_URL = os.environ["ACTIVITY_WORKER_API_URL"].rstrip("/") + "/"
TOKEN = os.environ["ACTIVITY_WORKER_TOKEN"]
model: Any = None
model_lock = threading.Lock()
PROGRESS_PREFIX = "partyroom-progress:"

worker = Worker(api_url=API_URL, token=TOKEN, worker_id=os.getenv("ACTIVITY_WORKER_ID", "lyrics-worker"),
                task_queue="lyrics", max_concurrent_activities=int(os.getenv("LYRICS_WORKER_CONCURRENCY", "1")))


async def download(url: str, destination: Path) -> None:
    size = 0
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(60, read=600), follow_redirects=True
    ) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            declared_size = int(response.headers.get("content-length", "0"))
            if declared_size > MAX_BYTES:
                raise ValueError("Input exceeds MAX_MEDIA_BYTES")
            with destination.open("wb") as output:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise ValueError("Input exceeds MAX_MEDIA_BYTES")
                    output.write(chunk)


def get_model() -> Any:
    global model
    if model is not None:
        return model
    with model_lock:
        if model is not None:
            return model
        import torch
        from qwen_asr import Qwen3ASRModel

        requested_device = os.getenv("LYRICS_DEVICE", "auto")
        device = (
            "cuda:0"
            if requested_device == "auto" and torch.cuda.is_available()
            else requested_device
        )
        if device == "auto":
            device = "cpu"
        dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
        model = Qwen3ASRModel.from_pretrained(
            ASR_MODEL,
            dtype=dtype,
            device_map=device,
            max_inference_batch_size=1,
            max_new_tokens=MAX_NEW_TOKENS,
            forced_aligner=ALIGNER_MODEL,
            forced_aligner_kwargs={"dtype": dtype, "device_map": device},
        )
        return model


def transcribe_to_artifacts(
    audio_path: Path,
    vtt_path: Path,
    lyrics_path: Path,
    cancelled: threading.Event,
    chunk_completed: Callable[[int, int], None] | None = None,
) -> str | None:
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

    language, words = transcribe_audio_chunks(
        get_model(),
        mono,
        sample_rate=target_sample_rate,
        chunk_seconds=CHUNK_SECONDS,
        cancelled=cancelled,
        chunk_completed=chunk_completed,
    )
    if cancelled.is_set():
        raise TranscriptionCancelled("Transcription was cancelled")
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


async def run_transcription(
    context: ActivityContext, input_path: Path, vtt_path: Path, lyrics_path: Path
) -> str | None:
    result_path = lyrics_path.with_name("transcription-result.json")

    async def process_output(line: str) -> None:
        if not line.startswith(PROGRESS_PREFIX):
            return
        progress = json.loads(line[len(PROGRESS_PREFIX) :])
        completed = int(progress["completed"])
        total = int(progress["total"])
        await context.report_progress(
            0.1 + 0.8 * completed / total,
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


@worker.activity(transcribe)
async def transcribe_activity(context: ActivityContext, activity: TranscribeInput) -> TranscribeOutput:
    directory = WORK_DIR / f"{context.info.activity_id}-{context.info.attempt}"
    input_path = directory / "vocals.flac"
    vtt_path = directory / "lyrics.vtt"
    lyrics_path = directory / "timed-lyrics.json"
    directory.mkdir(parents=True, exist_ok=True)
    try:
        await context.report_progress(0, "Downloading vocal stem")
        await download(activity.audio_url, input_path)
        await context.report_progress(0.1, f"Transcribing and aligning lyrics with {ASR_MODEL}")
        language = await run_transcription(context, input_path, vtt_path, lyrics_path)
        await context.report_progress(0.92, "Uploading timed lyric artifacts")
        if vtt_path.stat().st_size > MAX_BYTES or lyrics_path.stat().st_size > MAX_BYTES:
            raise ValueError("Output exceeds MAX_MEDIA_BYTES")
        lyrics_artifact_id = await context.upload_artifact(
            "lyricsArtifactId", vtt_path, "text/vtt"
        )
        timed_lyrics_artifact_id = await context.upload_artifact(
            "timedLyricsArtifactId", lyrics_path, "application/json"
        )
        return TranscribeOutput(
            lyrics_artifact_id=lyrics_artifact_id,
            timed_lyrics_artifact_id=timed_lyrics_artifact_id,
            content_type="text/vtt", model=ASR_MODEL, language=language,
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
        "inferenceMode": "managed-process",
    }
