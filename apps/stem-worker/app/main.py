import os
import shutil
from collections.abc import Awaitable, Callable
from pathlib import Path

import httpx
from fastapi import FastAPI
from partyroom_activity_worker import ActivityContext, Worker, replace_url_origin

from .activities_generated import SeparateInput, SeparateOutput, separate
from .model import ensure_model
from .separation import SEPARATION_END, SEPARATION_START, run_separator

WORK_DIR = Path(os.getenv("WORK_DIR", "/work"))
MODEL_DIR = Path(os.getenv("MODEL_DIR", "/models"))
MODEL = os.getenv("STEM_MODEL", "Kim_Vocal_2.onnx")
MAX_BYTES = int(os.getenv("MAX_MEDIA_BYTES", str(2 * 1024 * 1024 * 1024)))
API_URL = os.environ["ACTIVITY_WORKER_API_URL"].rstrip("/") + "/"
TOKEN = os.environ["ACTIVITY_WORKER_TOKEN"]
ARTIFACT_ORIGIN = os.getenv("ACTIVITY_ARTIFACT_ORIGIN")

worker = Worker(
    api_url=API_URL,
    token=TOKEN,
    worker_id=os.getenv("ACTIVITY_WORKER_ID", "stem-worker"),
    task_queue="stems",
    max_concurrent_activities=int(os.getenv("STEM_WORKER_CONCURRENCY", "1")),
    artifact_origin=ARTIFACT_ORIGIN,
)


def artifact_url(url: str) -> str:
    return replace_url_origin(url, ARTIFACT_ORIGIN) if ARTIFACT_ORIGIN else url


async def download(
    url: str,
    destination: Path,
    on_progress: Callable[[int, int], Awaitable[None]] | None = None,
) -> None:
    size = 0
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(60, read=300), follow_redirects=True
    ) as client:
        async with client.stream("GET", artifact_url(url)) as response:
            response.raise_for_status()
            total = int(response.headers.get("content-length", "0"))
            if total > MAX_BYTES:
                raise ValueError("Input exceeds MAX_MEDIA_BYTES")
            if on_progress is not None:
                await on_progress(0, total)
            with destination.open("wb") as output:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise ValueError("Input exceeds MAX_MEDIA_BYTES")
                    output.write(chunk)
                    if on_progress is not None:
                        await on_progress(size, total)


@worker.activity(separate)
async def separate_activity(context: ActivityContext, activity: SeparateInput) -> SeparateOutput:
    directory = WORK_DIR / f"{context.info.activity_id}-{context.info.attempt}"
    input_path = directory / "input.wav"
    output_path = directory / "instrumental.flac"
    vocals_path = directory / "vocals.flac"
    directory.mkdir(parents=True, exist_ok=True)
    try:
        await context.report_progress(0, "Downloading extracted audio")
        await download(
            activity.audio_url,
            input_path,
            context.progress_reporter(0, 0.01, "Downloading extracted audio"),
        )
        await context.report_progress(0.01, f"Preparing separation model {MODEL}")
        await ensure_model(MODEL_DIR, MODEL, context.run_process)
        await context.report_progress(SEPARATION_START, f"Separating stems with {MODEL}")
        result = await run_separator(context, input_path, MODEL, MODEL_DIR, directory)
        output = (result.stdout + result.stderr).decode(errors="replace")
        if not output_path.exists():
            candidates = list(directory.glob("*Instrumental*.flac")) + list(directory.glob("*instrumental*.flac"))
            if not candidates:
                raise RuntimeError(
                    f"audio-separator did not produce an instrumental stem: {output[-4000:]}"
                )
            output_path = candidates[0]
        if not vocals_path.exists():
            candidates = list(directory.glob("*Vocals*.flac")) + list(directory.glob("*vocals*.flac"))
            if not candidates:
                raise RuntimeError(
                    f"audio-separator did not produce a vocal stem: {output[-4000:]}"
                )
            vocals_path = candidates[0]
        await context.report_progress(SEPARATION_END, "Uploading separated stems")
        if output_path.stat().st_size > MAX_BYTES or vocals_path.stat().st_size > MAX_BYTES:
            raise ValueError("Output exceeds MAX_MEDIA_BYTES")
        return SeparateOutput(
            instrumental_artifact_id=await context.upload_artifact(
                "instrumentalArtifactId",
                output_path,
                "audio/flac",
                on_progress=context.progress_reporter(
                    SEPARATION_END, 0.99, "Uploading instrumental stem"
                ),
            ),
            vocals_artifact_id=await context.upload_artifact(
                "vocalsArtifactId",
                vocals_path,
                "audio/flac",
                on_progress=context.progress_reporter(
                    0.99, 1, "Uploading vocal stem"
                ),
            ),
            content_type="audio/flac",
            model=MODEL,
        )
    finally:
        shutil.rmtree(directory, ignore_errors=True)


WORK_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="Partyroom stem worker", lifespan=worker.lifespan)


@app.get("/health")
async def health() -> dict[str, object]:
    return {**worker.health(), "model": MODEL}
