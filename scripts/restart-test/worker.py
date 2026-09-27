"""Real Python worker runtime, deterministic lyrics handlers for restart testing."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import httpx
from partyroom_activity_worker import Worker

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("lyrics_contracts", ROOT / "apps/lyrics-worker/app/activities_generated.py")
contracts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contracts)
directory = Path(os.environ["RESTART_TEST_DIRECTORY"])

async def main():
    worker = Worker(api_url=os.environ["RESTART_TEST_API"], token=os.environ["RESTART_TEST_TOKEN"], worker_id="restart-python", task_queue="lyrics", idle_poll_interval=0.1)
    for definition in [contracts.transcribe, contracts.align_lyrics]:
        def register(definition):
            @worker.activity(definition)
            async def handler(context, request):
                name = definition.name.split(".")[1]
                async with httpx.AsyncClient() as client:
                    response = await client.get(request.audio_url)
                    response.raise_for_status()
                output = {"contentType": "application/json", "model": "restart-fixture"}
                if name == "alignLyrics":
                    output["language"] = "en"
                for slot in definition.artifact_slots:
                    artifact = directory / f"{name}-{context.info.attempt}-{slot}.txt"
                    artifact.write_text(json.dumps({"observations": [{"time": 0, "duration": 1, "value": "test"}]}))
                    output[slot] = await context.upload_artifact(slot, artifact, "application/json")
                (directory / f"{name}-{context.info.attempt}.json").write_text(json.dumps({"activityId": context.info.activity_id, "output": output}))
                while not (directory / f"allow-{name}").exists():
                    await asyncio.sleep(0.1)
                return definition.output_model.model_validate(output)
        register(definition)
    await worker.start()
    await asyncio.Event().wait()

asyncio.run(main())
