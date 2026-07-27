import asyncio
import json
import os
import shutil
import sys
from collections.abc import Awaitable, Callable
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


async def download(
    url: str,
    destination: Path,
    on_progress: Callable[[int, int], Awaitable[None]] | None = None,
) -> None:
    size = 0
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(60, read=600), follow_redirects=True
    ) as client:
        async with client.stream("GET", url) as response:
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


@worker.activity(analyze_melody)
async def analyze(context: ActivityContext, activity: AnalyzeMelodyInput) -> AnalyzeMelodyOutput:
    directory = WORK_DIR / f"{context.info.activity_id}-{context.info.attempt}"
    directory.mkdir(parents=True, exist_ok=True)
    audio_path = directory / "vocals.flac"
    output_path = directory / "melody.json"
    try:
        await context.report_progress(0, "Downloading vocal stem")
        await download(
            activity.audio_url,
            audio_path,
            context.progress_reporter(0, 0.25, "Downloading vocal stem"),
        )
        await context.report_progress(
            0.25, f"Extracting notes and pitch with {MELODY_MODEL}"
        )

        async def process_output(line: str) -> None:
            prefix = "partyroom-progress:"
            if not line.startswith(prefix):
                return
            stage = json.loads(line[len(prefix) :]).get("stage")
            stages = {
                "decoded": (0.5, "Decoded vocal audio"),
                "pitch": (0.67, "Extracted pitch probabilities"),
                "notes": (0.71, "Constructed vocal notes"),
                "written": (0.75, "Serialized melody analysis"),
            }
            if stage in stages:
                progress, message = stages[stage]
                await context.report_progress(progress, message)

        await context.run_process(
            sys.executable,
            "-m",
            "app.melody_process",
            str(audio_path),
            str(output_path),
            on_stdout_line=process_output,
        )
        await context.report_progress(0.75, "Uploading melody analysis")
        if output_path.stat().st_size > MAX_BYTES:
            raise ValueError("Output exceeds MAX_MEDIA_BYTES")
        return AnalyzeMelodyOutput(
            artifact_id=await context.upload_artifact(
                "artifactId",
                output_path,
                "application/json",
                on_progress=context.progress_reporter(
                    0.75, 1, "Uploading melody analysis"
                ),
            ),
            content_type="application/json",
            model=MELODY_MODEL,
        )
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
        await asyncio.gather(
            download(
                activity.lyrics_url,
                lyrics_path,
                context.progress_reporter(0, 0.125, "Downloading timed lyrics"),
            ),
            download(
                activity.melody_url,
                melody_path,
                context.progress_reporter(
                    0.125, 0.25, "Downloading melody analysis"
                ),
            ),
        )
        lyrics = json.loads(lyrics_path.read_text(encoding="utf-8"))
        melody = json.loads(melody_path.read_text(encoding="utf-8"))
        await context.report_progress(0.25, "Validating and exporting JAMS annotations")
        jam = build_jams(lyrics, melody, duration=activity.duration, title=activity.title,
                         extractor=activity.extractor, source_id=activity.source_id)
        jam.save(str(jams_path), strict=True)
        await context.report_progress(0.5, "Exporting vocal-guide MIDI")
        write_midi(melody.get("notes", []), lyrics.get("observations", []), midi_path)
        await context.report_progress(0.625, "Exporting vocal-guide MusicXML")
        write_musicxml(melody.get("notes", []), lyrics.get("observations", []),
                       duration=activity.duration, title=activity.title, path=musicxml_path)
        await context.report_progress(0.75, "Uploading annotation exports")
        if any(
            path.stat().st_size > MAX_BYTES
            for path in (jams_path, midi_path, musicxml_path)
        ):
            raise ValueError("Output exceeds MAX_MEDIA_BYTES")
        return AssembleAnnotationsOutput(
            annotations_artifact_id=await context.upload_artifact(
                "annotationsArtifactId",
                jams_path,
                "application/json",
                on_progress=context.progress_reporter(
                    0.75, 0.833, "Uploading JAMS annotations"
                ),
            ),
            midi_artifact_id=await context.upload_artifact(
                "midiArtifactId",
                midi_path,
                "audio/midi",
                on_progress=context.progress_reporter(
                    0.833, 0.917, "Uploading vocal-guide MIDI"
                ),
            ),
            music_xml_artifact_id=await context.upload_artifact(
                "musicXmlArtifactId",
                musicxml_path,
                "application/vnd.recordare.musicxml+xml",
                on_progress=context.progress_reporter(
                    0.917, 1, "Uploading vocal-guide MusicXML"
                ),
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
