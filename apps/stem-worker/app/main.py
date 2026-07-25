import json
import os
import shutil
from pathlib import Path

import httpx
from fastapi import FastAPI
from partyroom_activity_worker import ActivityContext, Worker

from .activities_generated import SeparateInput, SeparateOutput, separate
from .model import ensure_model

WORK_DIR = Path(os.getenv("WORK_DIR", "/work"))
MODEL_DIR = Path(os.getenv("MODEL_DIR", "/models"))
MODEL = os.getenv("STEM_MODEL", "Kim_Vocal_2.onnx")
MAX_BYTES = int(os.getenv("MAX_MEDIA_BYTES", str(2 * 1024 * 1024 * 1024)))
API_URL = os.environ["ACTIVITY_WORKER_API_URL"].rstrip("/") + "/"
TOKEN = os.environ["ACTIVITY_WORKER_TOKEN"]

worker = Worker(
    api_url=API_URL,
    token=TOKEN,
    worker_id=os.getenv("ACTIVITY_WORKER_ID", "stem-worker"),
    task_queue="stems",
    max_concurrent_activities=int(os.getenv("STEM_WORKER_CONCURRENCY", "1")),
)


async def download(url: str, destination: Path) -> None:
    size = 0
    async with httpx.AsyncClient(timeout=httpx.Timeout(60, read=300), follow_redirects=True) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            if int(response.headers.get("content-length", "0")) > MAX_BYTES:
                raise ValueError("Input exceeds MAX_MEDIA_BYTES")
            with destination.open("wb") as output:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise ValueError("Input exceeds MAX_MEDIA_BYTES")
                    output.write(chunk)


@worker.activity(separate)
async def separate_activity(context: ActivityContext, activity: SeparateInput) -> SeparateOutput:
    directory = WORK_DIR / f"{context.info.activity_id}-{context.info.attempt}"
    input_path = directory / "input.wav"
    output_path = directory / "instrumental.flac"
    vocals_path = directory / "vocals.flac"
    directory.mkdir(parents=True, exist_ok=True)
    try:
        await context.report_progress(0, "Downloading extracted audio")
        await download(activity.audio_url, input_path)
        await context.report_progress(0.1, f"Preparing separation model {MODEL}")
        await ensure_model(MODEL_DIR, MODEL, context.run_process)
        await context.report_progress(0.15, f"Separating instrumental with {MODEL}")
        result = await context.run_process(
            "audio-separator", str(input_path), "--model_filename", MODEL,
            "--model_file_dir", str(MODEL_DIR), "--output_dir", str(directory),
            "--output_format", "FLAC", "--custom_output_names",
            json.dumps({"Instrumental": "instrumental", "Vocals": "vocals"}),
        )
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
        await context.report_progress(0.95, "Uploading separated stems")
        if output_path.stat().st_size > MAX_BYTES or vocals_path.stat().st_size > MAX_BYTES:
            raise ValueError("Output exceeds MAX_MEDIA_BYTES")
        return SeparateOutput(
            instrumental_storage_id=await context.upload_artifact(
                "instrumentalStorageId", output_path, "audio/flac"
            ),
            vocals_storage_id=await context.upload_artifact(
                "vocalsStorageId", vocals_path, "audio/flac"
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
