import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel

from partyroom_activity_worker import (
    ActivityContext,
    ActivityDefinition,
    ActivityInfo,
    ApplicationError,
    Worker,
)


class EchoInput(BaseModel):
    value: str


class EchoOutput(BaseModel):
    echoed: str


def claimed(lease_duration_ms: int = 30_000) -> dict[str, Any]:
    import time

    now = time.time() * 1000
    return {
        "protocolVersion": 1,
        "activityId": "activity-1",
        "activityType": "test.echo",
        "activityVersion": 1,
        "taskQueue": "test",
        "attempt": 1,
        "leaseToken": "lease-token",
        "leaseExpiresAt": now + lease_duration_ms,
        "attemptDeadline": now + 60_000,
        "scheduleDeadline": now + 300_000,
        "input": {"value": "hello"},
    }


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_progress_reporter_is_monotonic(self) -> None:
        renewals: list[float] = []

        async def renew(**values: object) -> None:
            renewals.append(float(values["progress"]))

        context = ActivityContext(
            ActivityInfo(
                activity_id="activity-1",
                activity_type="test.echo",
                activity_version=1,
                task_queue="test",
                attempt=1,
                attempt_deadline=0,
                schedule_deadline=0,
            ),
            renew,
            asyncio.Event(),
        )
        report = context.progress_reporter(
            0.2, 0.4, "Working", min_interval=0, min_delta=0
        )
        await report(1, 4)
        await context.report_progress(0.1, "A stale phase")
        await report(4, 4)

        self.assertEqual(renewals, [0.25, 0.25, 0.4])

    async def test_passes_upload_progress_callback(self) -> None:
        observed: list[tuple[int, int]] = []

        async def upload(
            _slot: str,
            _source: Path,
            _content_type: str,
            on_progress: Any,
        ) -> str:
            await on_progress(3, 10)
            return "artifact-1"

        context = ActivityContext(
            ActivityInfo(
                activity_id="activity-1",
                activity_type="test.echo",
                activity_version=1,
                task_queue="test",
                attempt=1,
                attempt_deadline=0,
                schedule_deadline=0,
                artifact_slots=("file",),
            ),
            lambda **_values: asyncio.sleep(0),
            asyncio.Event(),
            upload,
        )

        async def progress(completed: int, total: int) -> None:
            observed.append((completed, total))

        await context.upload_artifact(
            "file", Path("file.txt"), "text/plain", on_progress=progress
        )
        self.assertEqual(observed, [(3, 10)])

    async def test_rewrites_artifact_upload_origin(self) -> None:
        claimed_once = False
        uploaded_to: str | None = None
        completed = asyncio.Event()

        async def handle(request: httpx.Request) -> httpx.Response:
            nonlocal claimed_once, uploaded_to
            if request.url.path.endswith("/claim"):
                if claimed_once:
                    return httpx.Response(200, json=None)
                claimed_once = True
                return httpx.Response(
                    200,
                    json={
                        **claimed(),
                        "artifactSlots": ["file"],
                    },
                )
            if request.url.path.endswith("/artifact-upload-url"):
                return httpx.Response(
                    200,
                    json={
                        "uploadUrl": "http://backend:3210/api/storage/upload?token=one"
                    },
                )
            if request.url.path == "/api/storage/upload":
                uploaded_to = str(request.url)
                return httpx.Response(200, json={"storageId": "storage-1"})
            if request.url.path.endswith("/artifact-register"):
                return httpx.Response(200, json={"artifactId": "artifact-1"})
            if request.url.path.endswith("/complete"):
                completed.set()
                return httpx.Response(200, json={"accepted": True, "duplicate": False})
            raise AssertionError(f"Unexpected URL {request.url}")

        worker = Worker(
            api_url="http://activities.test/workers",
            token="token",
            worker_id="worker",
            task_queue="test",
            artifact_origin="http://127.0.0.1:3210",
            idle_poll_interval=0.1,
            transport=httpx.MockTransport(handle),
        )
        definition = ActivityDefinition(
            name="test.echo",
            version=1,
            task_queue="test",
            input_model=EchoInput,
            output_model=EchoOutput,
            artifact_slots=("file",),
        )

        @worker.activity(definition)
        async def upload(context: ActivityContext, request: EchoInput) -> EchoOutput:
            with tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "file.txt"
                source.write_text("contents")
                await context.upload_artifact("file", source, "text/plain")
            return EchoOutput(echoed=request.value)

        await worker.start()
        await asyncio.wait_for(completed.wait(), timeout=2)
        await worker.stop()

        self.assertEqual(
            uploaded_to, "http://127.0.0.1:3210/api/storage/upload?token=one"
        )

    async def test_uploads_only_declared_artifact_slots(self) -> None:
        uploaded: tuple[str, Path, str] | None = None

        async def upload(slot: str, source: Path, content_type: str) -> str:
            nonlocal uploaded
            uploaded = (slot, source, content_type)
            return "artifact-1"

        context = ActivityContext(
            ActivityInfo(
                activity_id="activity-1",
                activity_type="test.echo",
                activity_version=1,
                task_queue="test",
                attempt=1,
                attempt_deadline=0,
                schedule_deadline=0,
                artifact_slots=("file",),
            ),
            lambda **_values: asyncio.sleep(0),
            asyncio.Event(),
            upload,
        )
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "file.txt"
            source.write_text("contents")
            artifact_id = await context.upload_artifact("file", source, "text/plain")

        self.assertEqual(artifact_id, "artifact-1")
        self.assertEqual(uploaded, ("file", source, "text/plain"))
        with self.assertRaisesRegex(ValueError, "does not declare"):
            await context.upload_artifact("other", source, "text/plain")

    async def test_managed_process_is_terminated_when_activity_is_cancelled(self) -> None:
        context = ActivityContext(
            ActivityInfo(
                activity_id="activity-1",
                activity_type="test.echo",
                activity_version=1,
                task_queue="test",
                attempt=1,
                attempt_deadline=0,
                schedule_deadline=0,
            ),
            lambda **_values: asyncio.sleep(0),
            asyncio.Event(),
        )
        task = asyncio.create_task(
            context.run_process(
                sys.executable,
                "-c",
                "import time; print('started', flush=True); time.sleep(30)",
            )
        )
        await asyncio.sleep(0.1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=2)

    async def test_renews_lease_while_handler_is_running(self) -> None:
        claimed_once = False
        renewals = 0
        completed = asyncio.Event()

        async def handle(request: httpx.Request) -> httpx.Response:
            nonlocal claimed_once, renewals
            if request.url.path.endswith("/claim"):
                if claimed_once:
                    return httpx.Response(200, json=None)
                claimed_once = True
                return httpx.Response(200, json=claimed(600))
            if request.url.path.endswith("/renew"):
                renewals += 1
                return httpx.Response(
                    200,
                    json={
                        "accepted": True,
                        "cancelRequested": False,
                        "leaseExpiresAt": __import__("time").time() * 1000 + 600,
                    },
                )
            if request.url.path.endswith("/complete"):
                completed.set()
                return httpx.Response(200, json={"accepted": True, "duplicate": False})
            raise AssertionError(f"Unexpected path {request.url.path}")

        worker = Worker(
            api_url="http://activities.test/workers",
            token="token",
            worker_id="worker",
            task_queue="test",
            idle_poll_interval=0.1,
            transport=httpx.MockTransport(handle),
        )
        definition = ActivityDefinition(
            name="test.echo",
            version=1,
            task_queue="test",
            input_model=EchoInput,
            output_model=EchoOutput,
        )

        @worker.activity(definition)
        async def slow(context: ActivityContext, request: EchoInput) -> EchoOutput:
            await context.run_process(
                sys.executable, "-c", "import time; time.sleep(0.8)"
            )
            return EchoOutput(echoed=request.value)

        await worker.start()
        await asyncio.wait_for(completed.wait(), timeout=2)
        health = worker.health()
        await worker.stop()

        self.assertGreaterEqual(renewals, 2)
        self.assertIsInstance(health["lastRenewalAt"], float)
        self.assertIsInstance(health["eventLoopLagMs"], float)

    async def test_executes_and_completes_claimed_activity(self) -> None:
        claimed_once = False
        completion: dict[str, Any] | None = None
        completed = asyncio.Event()

        async def handle(request: httpx.Request) -> httpx.Response:
            nonlocal claimed_once, completion
            if request.url.path.endswith("/claim"):
                import json

                self.assertEqual(json.loads(request.content)["protocolVersion"], 1)
                if claimed_once:
                    return httpx.Response(200, json=None)
                claimed_once = True
                return httpx.Response(200, json=claimed())
            if request.url.path.endswith("/complete"):
                import json

                completion = json.loads(request.content)
                completed.set()
                return httpx.Response(200, json={"accepted": True, "duplicate": False})
            raise AssertionError(f"Unexpected path {request.url.path}")

        worker = Worker(
            api_url="http://activities.test/workers",
            token="token",
            worker_id="worker",
            task_queue="test",
            idle_poll_interval=0.1,
            transport=httpx.MockTransport(handle),
        )
        definition = ActivityDefinition(
            name="test.echo",
            version=1,
            task_queue="test",
            input_model=EchoInput,
            output_model=EchoOutput,
        )

        @worker.activity(definition)
        async def echo(_context: object, request: EchoInput) -> EchoOutput:
            return EchoOutput(echoed=request.value)

        await worker.start()
        await asyncio.wait_for(completed.wait(), timeout=2)
        await worker.stop()

        self.assertIsNotNone(completion)
        assert completion is not None
        self.assertEqual(completion["value"], {"echoed": "hello"})
        self.assertEqual(completion["leaseToken"], "lease-token")
        self.assertIsInstance(completion["requestId"], str)

    async def test_reports_non_retryable_application_error(self) -> None:
        claimed_once = False
        failure: dict[str, Any] | None = None
        failed = asyncio.Event()

        async def handle(request: httpx.Request) -> httpx.Response:
            nonlocal claimed_once, failure
            if request.url.path.endswith("/claim"):
                if claimed_once:
                    return httpx.Response(200, json=None)
                claimed_once = True
                return httpx.Response(200, json=claimed())
            if request.url.path.endswith("/fail"):
                import json

                failure = json.loads(request.content)
                failed.set()
                return httpx.Response(
                    200,
                    json={"accepted": True, "duplicate": False, "retrying": False},
                )
            raise AssertionError(f"Unexpected path {request.url.path}")

        worker = Worker(
            api_url="http://activities.test/workers",
            token="token",
            worker_id="worker",
            task_queue="test",
            idle_poll_interval=0.1,
            transport=httpx.MockTransport(handle),
        )
        definition = ActivityDefinition(
            name="test.echo",
            version=1,
            task_queue="test",
            input_model=EchoInput,
            output_model=EchoOutput,
        )

        @worker.activity(definition)
        async def fail(_context: object, _request: EchoInput) -> EchoOutput:
            raise ApplicationError(
                "bad input", error_type="UnsupportedInput", non_retryable=True
            )

        await worker.start()
        await asyncio.wait_for(failed.wait(), timeout=2)
        await worker.stop()

        self.assertIsNotNone(failure)
        assert failure is not None
        self.assertEqual(failure["errorType"], "UnsupportedInput")
        self.assertTrue(failure["nonRetryable"])


if __name__ == "__main__":
    unittest.main()
