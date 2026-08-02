import json
import os
import shutil
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path

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
from .chunked import cleanup_stale_work, write_text_atomic
from .settings import positive_int_setting


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
LYRICS_DEVICE = os.getenv("LYRICS_DEVICE", "auto")
PROGRESS_PREFIX = "partyroom-progress:"

worker = Worker(
    api_url=API_URL,
    token=TOKEN,
    worker_id=os.getenv("ACTIVITY_WORKER_ID", "lyrics-worker"),
    task_queue="lyrics",
    max_concurrent_activities=int(os.getenv("LYRICS_WORKER_CONCURRENCY", "2")),
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
        LYRICS_BACKEND,
        ASR_MODEL,
        ALIGNER_MODEL,
        str(MAX_NEW_TOKENS),
        str(CHUNK_SECONDS),
        LYRICS_DEVICE,
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
) -> str:
    result_path = lyrics_path.with_name("alignment-result.json")

    async def process_output(line: str) -> None:
        if not line.startswith(PROGRESS_PREFIX):
            return
        stage = json.loads(line[len(PROGRESS_PREFIX) :]).get("stage")
        if stage == "detectingLanguage":
            await context.report_progress(0.25, "Detecting lyrics language")
        elif stage == "loadingModel":
            await context.report_progress(0.3, f"Loading {ALIGNER_MODEL}")
        elif stage == "preprocessing":
            await context.report_progress(0.4, "Preparing vocal audio")
        elif stage == "aligning":
            await context.report_progress(0.55, "Aligning lyric transcript")
        elif stage == "writing":
            await context.report_progress(0.75, "Writing word-timed lyrics")

    await context.run_process(
        sys.executable,
        "-m",
        "app.alignment_process",
        LYRICS_BACKEND,
        ALIGNER_MODEL,
        LYRICS_DEVICE,
        str(input_path),
        str(transcript_path),
        str(lyrics_path),
        str(result_path),
        on_stdout_line=process_output,
    )
    result = json.loads(result_path.read_text(encoding="utf-8"))
    return str(result["language"])


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
    transcript_path = directory / "transcript.txt"
    lyrics_path = directory / "timed-lyrics.json"
    directory.mkdir(parents=True, exist_ok=True)
    try:
        await context.report_progress(0, "Downloading vocal stem")
        await download(
            activity.audio_url,
            input_path,
            context.progress_reporter(0, 0.25, "Downloading vocal stem"),
        )
        write_text_atomic(transcript_path, activity.transcript)
        language = await run_alignment(
            context,
            input_path,
            transcript_path,
            lyrics_path,
        )
        await context.report_progress(0.75, "Uploading aligned lyrics")
        if lyrics_path.stat().st_size > MAX_BYTES:
            raise ValueError("Output exceeds MAX_MEDIA_BYTES")
        timed_lyrics_artifact_id = await context.upload_artifact(
            "timedLyricsArtifactId",
            lyrics_path,
            "application/json",
            on_progress=context.progress_reporter(
                0.75, 1, "Uploading word-timed lyrics"
            ),
        )
        return AlignLyricsOutput(
            timed_lyrics_artifact_id=timed_lyrics_artifact_id,
            content_type="application/json",
            model=ALIGNER_MODEL,
            language=language,
        )
    finally:
        shutil.rmtree(directory, ignore_errors=True)


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
        "backend": LYRICS_BACKEND,
        "inferenceMode": "managed-process",
    }
