import asyncio
import json
import os
import shutil
import sys
from pathlib import Path

import httpx
from fastapi import FastAPI
from partyroom_activity_worker import ActivityContext, Worker

from .activities_generated import (
    AnalyzeMelodyInput, AnalyzeMelodyOutput, AssembleAnnotationsInput,
    AssembleAnnotationsOutput, analyze_melody, assemble_annotations,
)
from .exporters import build_jams, write_midi, write_musicxml


WORK_DIR = Path(os.getenv("WORK_DIR", "/work"))
MAX_BYTES = int(os.getenv("MAX_MEDIA_BYTES", str(2 * 1024 * 1024 * 1024)))
MELODY_MODEL = "librosa.pyin"
API_URL = os.environ["ACTIVITY_WORKER_API_URL"].rstrip("/") + "/"
TOKEN = os.environ["ACTIVITY_WORKER_TOKEN"]
worker = Worker(api_url=API_URL, token=TOKEN, worker_id=os.getenv("ACTIVITY_WORKER_ID", "annotations-worker"),
                task_queue="annotations", max_concurrent_activities=int(os.getenv("ANNOTATIONS_WORKER_CONCURRENCY", "1")))


async def download(url: str, destination: Path) -> None:
    size = 0
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(60, read=600), follow_redirects=True
    ) as client:
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


@worker.activity(analyze_melody)
async def analyze(context: ActivityContext, activity: AnalyzeMelodyInput) -> AnalyzeMelodyOutput:
    directory = WORK_DIR / f"{context.info.activity_id}-{context.info.attempt}"
    directory.mkdir(parents=True, exist_ok=True)
    audio_path = directory / "vocals.flac"
    output_path = directory / "melody.json"
    try:
        await context.report_progress(0, "Downloading vocal stem")
        await download(activity.audio_url, audio_path)
        await context.report_progress(0.15, f"Extracting notes and pitch with {MELODY_MODEL}")
        await context.run_process(
            sys.executable,
            "-m",
            "app.melody_process",
            str(audio_path),
            str(output_path),
        )
        await context.report_progress(0.95, "Uploading melody analysis")
        if output_path.stat().st_size > MAX_BYTES:
            raise ValueError("Output exceeds MAX_MEDIA_BYTES")
        return AnalyzeMelodyOutput(storage_id=await context.upload_artifact(
                                       "storageId", output_path, "application/json"),
                                   content_type="application/json", model=MELODY_MODEL)
    finally:
        shutil.rmtree(directory, ignore_errors=True)


@worker.activity(assemble_annotations)
async def assemble(context: ActivityContext, activity: AssembleAnnotationsInput) -> AssembleAnnotationsOutput:
    directory = WORK_DIR / f"{context.info.activity_id}-{context.info.attempt}"
    directory.mkdir(parents=True, exist_ok=True)
    lyrics_path = directory / "timed-lyrics.json"
    melody_path = directory / "melody.json"
    jams_path = directory / "annotations.jams"
    midi_path = directory / "vocal-guide.mid"
    musicxml_path = directory / "vocal-guide.musicxml"
    try:
        await context.report_progress(0, "Downloading analyses")
        await asyncio.gather(download(activity.lyrics_url, lyrics_path), download(activity.melody_url, melody_path))
        lyrics = json.loads(lyrics_path.read_text(encoding="utf-8"))
        melody = json.loads(melody_path.read_text(encoding="utf-8"))
        await context.report_progress(0.3, "Validating JAMS and exporting interchange formats")
        jam = build_jams(lyrics, melody, duration=activity.duration, title=activity.title,
                         extractor=activity.extractor, source_id=activity.source_id)
        jam.save(str(jams_path), strict=True)
        write_midi(melody.get("notes", []), lyrics.get("observations", []), midi_path)
        write_musicxml(melody.get("notes", []), lyrics.get("observations", []),
                       duration=activity.duration, title=activity.title, path=musicxml_path)
        await context.report_progress(0.8, "Uploading annotation exports")
        if any(
            path.stat().st_size > MAX_BYTES
            for path in (jams_path, midi_path, musicxml_path)
        ):
            raise ValueError("Output exceeds MAX_MEDIA_BYTES")
        return AssembleAnnotationsOutput(
            annotations_storage_id=await context.upload_artifact(
                "annotationsStorageId", jams_path, "application/json"
            ),
            midi_storage_id=await context.upload_artifact(
                "midiStorageId", midi_path, "audio/midi"
            ),
            music_xml_storage_id=await context.upload_artifact(
                "musicXmlStorageId", musicxml_path,
                "application/vnd.recordare.musicxml+xml"
            ),
            content_type="application/json",
        )
    finally:
        shutil.rmtree(directory, ignore_errors=True)

WORK_DIR.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="Partyroom annotations worker", lifespan=worker.lifespan)


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        **worker.health(),
        "model": MELODY_MODEL,
    }
