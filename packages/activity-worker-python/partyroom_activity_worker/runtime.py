import asyncio
import contextlib
import inspect
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Generic, TypeVar, cast
from urllib.parse import urlsplit, urlunsplit

import httpx
from pydantic import BaseModel

from .protocol import (
    PROTOCOL_VERSION,
    ClaimedActivity,
    FailureResponse,
    RenewalResponse,
    TerminalResponse,
)


Input = TypeVar("Input", bound=BaseModel)
Output = TypeVar("Output", bound=BaseModel)


class ApplicationError(Exception):
    def __init__(
        self,
        message: str,
        *,
        error_type: str = "ApplicationError",
        non_retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.non_retryable = non_retryable


@dataclass(frozen=True)
class ActivityDefinition(Generic[Input, Output]):
    name: str
    version: int
    task_queue: str
    input_model: type[Input]
    output_model: type[Output]
    artifact_slots: tuple[str, ...] | list[str] = ()


@dataclass(frozen=True)
class ActivityInfo:
    activity_id: str
    activity_type: str
    activity_version: int
    task_queue: str
    attempt: int
    attempt_deadline: float
    schedule_deadline: float
    artifact_slots: tuple[str, ...] = ()


@dataclass(frozen=True)
class ManagedProcessResult:
    returncode: int
    stdout: bytes
    stderr: bytes


class ActivityContext:
    def __init__(
        self,
        info: ActivityInfo,
        renew: Callable[..., Awaitable[None]],
        cancellation: asyncio.Event,
        upload_artifact: Callable[..., Awaitable[str]] | None = None,
    ) -> None:
        self.info = info
        self._renew = renew
        self._cancellation = cancellation
        self._upload_artifact = upload_artifact
        self._last_reported_progress = 0.0
        self._progress_lock = asyncio.Lock()

    @property
    def is_cancelled(self) -> bool:
        return self._cancellation.is_set()

    async def wait_cancelled(self) -> None:
        await self._cancellation.wait()

    async def heartbeat(self, details: Any = None) -> None:
        await self._renew(heartbeat_details=details)

    async def report_progress(self, progress: float, message: str | None = None) -> None:
        async with self._progress_lock:
            progress = max(
                self._last_reported_progress, max(0.0, min(1.0, progress))
            )
            await self._renew(progress=progress, progress_message=message)
            self._last_reported_progress = progress

    def progress_reporter(
        self,
        start: float,
        end: float,
        message: str | Callable[[int, int], str],
        *,
        min_interval: float = 0.5,
        min_delta: float = 0.005,
    ) -> Callable[[int, int], Awaitable[None]]:
        """Map completed units into a throttled, monotonic activity progress range."""
        last_progress = -1.0
        last_reported_at = 0.0

        async def report(completed: int, total: int) -> None:
            nonlocal last_progress, last_reported_at
            if total <= 0:
                return
            fraction = max(0.0, min(1.0, completed / total))
            progress = start + (end - start) * fraction
            now = time.monotonic()
            finished = completed >= total
            if (
                not finished
                and last_progress >= 0
                and (
                    progress - last_progress < min_delta
                    or now - last_reported_at < min_interval
                )
            ):
                return
            progress_message = (
                message(completed, total) if callable(message) else message
            )
            await self.report_progress(progress, progress_message)
            last_progress = progress
            last_reported_at = now

        return report

    async def upload_artifact(
        self,
        slot: str,
        source: Path,
        content_type: str,
        *,
        on_progress: Callable[[int, int], Awaitable[None]] | None = None,
    ) -> str:
        if slot not in self.info.artifact_slots:
            raise ValueError(f"Activity does not declare artifact slot {slot}")
        if self._upload_artifact is None:
            raise RuntimeError("Artifact uploading is unavailable")
        if on_progress is None:
            return await self._upload_artifact(slot, source, content_type)
        return await self._upload_artifact(slot, source, content_type, on_progress)

    async def run_process(
        self,
        *command: str,
        check: bool = True,
        on_stdout_line: Callable[[str], Awaitable[None] | None] | None = None,
        terminate_timeout: float = 5.0,
        max_output_bytes: int = 1_048_576,
    ) -> ManagedProcessResult:
        """Run child work while the parent event loop remains available for leases."""
        if not command:
            raise ValueError("At least one command argument is required")
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout = bytearray()
        stderr = bytearray()

        async def read_stream(
            stream: asyncio.StreamReader | None,
            destination: bytearray,
            callback: Callable[[str], Awaitable[None] | None] | None = None,
        ) -> None:
            if stream is None:
                return
            while line := await stream.readline():
                destination.extend(line)
                if len(destination) > max_output_bytes:
                    del destination[: len(destination) - max_output_bytes]
                if callback is not None:
                    result = callback(line.decode(errors="replace").rstrip("\r\n"))
                    if inspect.isawaitable(result):
                        await result

        stdout_task = asyncio.create_task(
            read_stream(process.stdout, stdout, on_stdout_line)
        )
        stderr_task = asyncio.create_task(read_stream(process.stderr, stderr))
        try:
            returncode, _, _ = await asyncio.gather(
                process.wait(), stdout_task, stderr_task
            )
        except BaseException:
            for task in (stdout_task, stderr_task):
                task.cancel()
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=terminate_timeout)
                except TimeoutError:
                    process.kill()
                    await process.wait()
            await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
            raise

        result = ManagedProcessResult(returncode, bytes(stdout), bytes(stderr))
        if check and returncode != 0:
            detail = result.stderr.decode(errors="replace").strip()
            if len(detail) > 2_000:
                detail = detail[-2_000:]
            raise ApplicationError(
                f"{command[0]} exited with {returncode}"
                + (f": {detail}" if detail else "")
            )
        return result


Handler = Callable[[ActivityContext, BaseModel], Awaitable[BaseModel]]


def replace_url_origin(url: str, origin: str) -> str:
    source = urlsplit(url)
    replacement = urlsplit(origin)
    if not replacement.scheme or not replacement.netloc:
        raise ValueError("artifact_origin must include a scheme and host")
    return urlunsplit(
        (
            replacement.scheme,
            replacement.netloc,
            source.path,
            source.query,
            source.fragment,
        )
    )


class Worker:
    def __init__(
        self,
        *,
        api_url: str,
        token: str,
        worker_id: str,
        task_queue: str,
        max_concurrent_activities: int = 1,
        idle_poll_interval: float = 1.0,
        request_timeout: float = 10.0,
        artifact_origin: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not worker_id.strip():
            raise ValueError("worker_id must not be empty")
        if not task_queue.strip():
            raise ValueError("task_queue must not be empty")
        self.api_url = api_url.rstrip("/") + "/"
        self.token = token
        self.worker_id = worker_id
        self.instance_id = str(uuid.uuid4())
        self.task_queue = task_queue
        self.max_concurrent_activities = max(1, max_concurrent_activities)
        self.idle_poll_interval = max(0.1, idle_poll_interval)
        self.request_timeout = max(1.0, request_timeout)
        self.artifact_origin = artifact_origin
        self.transport = transport
        self._handlers: dict[str, tuple[ActivityDefinition[Any, Any], Handler]] = {}
        self._tasks: list[asyncio.Task[None]] = []
        self._client: httpx.AsyncClient | None = None
        self._stopping = asyncio.Event()
        self._running = 0
        self._last_poll_at: float | None = None
        self._last_renewal_at: float | None = None
        self._event_loop_lag_ms = 0.0
        self._max_event_loop_lag_ms = 0.0

    def activity(
        self, definition: ActivityDefinition[Input, Output]
    ) -> Callable[
        [Callable[[ActivityContext, Input], Awaitable[Output]]],
        Callable[[ActivityContext, Input], Awaitable[Output]],
    ]:
        if definition.task_queue != self.task_queue:
            raise ValueError(
                f"Activity {definition.name} belongs to {definition.task_queue}, not {self.task_queue}"
            )

        def register(
            handler: Callable[[ActivityContext, Input], Awaitable[Output]],
        ) -> Callable[[ActivityContext, Input], Awaitable[Output]]:
            key = _activity_key(definition.name, definition.version)
            if key in self._handlers:
                raise ValueError(f"Duplicate activity handler {key}")
            self._handlers[key] = (definition, cast(Handler, handler))
            return handler

        return register

    async def start(self) -> None:
        if self._client is not None:
            return
        if not self._handlers:
            raise RuntimeError("At least one activity handler is required")
        self._stopping.clear()
        self._client = httpx.AsyncClient(
            timeout=self.request_timeout,
            transport=self.transport,
            headers={"Authorization": f"Bearer {self.token}"},
        )
        self._tasks = [
            asyncio.create_task(self._poll(slot), name=f"activity-worker-{slot}")
            for slot in range(self.max_concurrent_activities)
        ]
        self._tasks.append(
            asyncio.create_task(self._monitor_event_loop(), name="activity-worker-lag")
        )

    async def stop(self) -> None:
        self._stopping.set()
        tasks, self._tasks = self._tasks, []
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @contextlib.asynccontextmanager
    async def lifespan(self, _app: object) -> AsyncIterator[None]:
        await self.start()
        try:
            yield
        finally:
            await self.stop()

    def health(self) -> dict[str, object]:
        return {
            "ok": True,
            "started": self._client is not None,
            "running": self._running,
            "concurrency": self.max_concurrent_activities,
            "taskQueue": self.task_queue,
            "activities": sorted(self._handlers),
            "lastPollAt": self._last_poll_at,
            "lastRenewalAt": self._last_renewal_at,
            "eventLoopLagMs": round(self._event_loop_lag_ms, 1),
            "maxEventLoopLagMs": round(self._max_event_loop_lag_ms, 1),
        }

    async def _monitor_event_loop(self) -> None:
        loop = asyncio.get_running_loop()
        expected = loop.time() + 1
        while not self._stopping.is_set():
            await asyncio.sleep(max(0, expected - loop.time()))
            now = loop.time()
            self._event_loop_lag_ms = max(0, (now - expected) * 1000)
            self._max_event_loop_lag_ms = max(
                self._max_event_loop_lag_ms, self._event_loop_lag_ms
            )
            expected = now + 1

    async def _poll(self, slot: int) -> None:
        while not self._stopping.is_set():
            try:
                self._last_poll_at = _now_ms()
                body = await self._request(
                    "claim",
                    {
                        "protocolVersion": PROTOCOL_VERSION,
                        "taskQueue": self.task_queue,
                        "workerId": f"{self.worker_id}:{self.instance_id}:{slot}",
                        "supportedActivities": [
                            {"name": definition.name, "version": definition.version}
                            for definition, _handler in self._handlers.values()
                        ],
                    },
                )
                if body is None:
                    await asyncio.sleep(self.idle_poll_interval)
                    continue
                claimed = ClaimedActivity.model_validate(body)
                self._running += 1
                try:
                    await self._execute(claimed)
                finally:
                    self._running -= 1
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 - polling must survive transient failures
                print(f"Activity claim failed: {error}")
                await asyncio.sleep(self.idle_poll_interval)

    async def _execute(self, claimed: ClaimedActivity) -> None:
        entry = self._handlers.get(_activity_key(claimed.activity_type, claimed.activity_version))
        if entry is None:
            return
        definition, handler = entry
        cancellation = asyncio.Event()
        lease_lost = asyncio.Event()
        lease_expires_at = claimed.lease_expires_at
        renew_lock = asyncio.Lock()

        async def renew(**values: object) -> None:
            nonlocal lease_expires_at
            async with renew_lock:
                body = await self._request(
                    "renew",
                    {
                        "activityId": claimed.activity_id,
                        "attempt": claimed.attempt,
                        "leaseToken": claimed.lease_token,
                        **_without_none(values),
                    },
                )
                response = RenewalResponse.model_validate(body)
                if not response.accepted:
                    lease_lost.set()
                    return
                self._last_renewal_at = _now_ms()
                if response.lease_expires_at is not None:
                    lease_expires_at = response.lease_expires_at
                if response.cancel_requested:
                    cancellation.set()

        async def renew_loop() -> None:
            while not cancellation.is_set() and not lease_lost.is_set():
                wait = max(0.25, min(5.0, (lease_expires_at - _now_ms()) / 3_000))
                await asyncio.sleep(wait)
                try:
                    await renew()
                except asyncio.CancelledError:
                    raise
                except Exception as error:  # noqa: BLE001
                    if _now_ms() >= lease_expires_at:
                        lease_lost.set()
                        return
                    print(f"Unable to renew activity {claimed.activity_id}: {error}")

        async def upload_artifact(
            slot: str,
            source: Path,
            content_type: str,
            on_progress: Callable[[int, int], Awaitable[None]] | None = None,
        ) -> str:
            if self._client is None:
                raise RuntimeError("Worker is not started")
            identity = {
                "activityId": claimed.activity_id,
                "attempt": claimed.attempt,
                "leaseToken": claimed.lease_token,
                "slot": slot,
            }
            prepared = await self._request("artifact-upload-url", identity)
            upload_url = prepared.get("uploadUrl")
            if not upload_url:
                raise ValueError("Artifact upload URL response is missing uploadUrl")
            if self.artifact_origin:
                upload_url = replace_url_origin(str(upload_url), self.artifact_origin)

            total_bytes = source.stat().st_size

            async def chunks() -> AsyncIterator[bytes]:
                uploaded_bytes = 0
                if on_progress is not None:
                    await on_progress(0, total_bytes)
                with source.open("rb") as body:
                    while chunk := await asyncio.to_thread(body.read, 1024 * 1024):
                        uploaded_bytes += len(chunk)
                        yield chunk
                        if on_progress is not None:
                            await on_progress(uploaded_bytes, total_bytes)

            response = await self._client.post(
                str(upload_url),
                content=chunks(),
                headers={
                    "Content-Type": content_type,
                    "Content-Length": str(total_bytes),
                },
                timeout=httpx.Timeout(60, write=600),
            )
            response.raise_for_status()
            storage_id = response.json().get("storageId")
            if not storage_id:
                raise ValueError("Artifact upload did not return a storageId")
            registered = await self._request(
                "artifact-register", {**identity, "storageId": storage_id}
            )
            artifact_id = registered.get("artifactId")
            if not artifact_id:
                raise ValueError("Artifact registration did not return an artifactId")
            return str(artifact_id)

        context = ActivityContext(
            ActivityInfo(
                activity_id=claimed.activity_id,
                activity_type=claimed.activity_type,
                activity_version=claimed.activity_version,
                task_queue=claimed.task_queue,
                attempt=claimed.attempt,
                attempt_deadline=claimed.attempt_deadline,
                schedule_deadline=claimed.schedule_deadline,
                artifact_slots=tuple(claimed.artifact_slots),
            ),
            renew,
            cancellation,
            upload_artifact,
        )
        renewal_task = asyncio.create_task(renew_loop())
        handler_task = asyncio.create_task(
            handler(context, definition.input_model.model_validate(claimed.input))
        )
        cancellation_task = asyncio.create_task(cancellation.wait())
        lease_lost_task = asyncio.create_task(lease_lost.wait())
        try:
            done, _pending = await asyncio.wait(
                {handler_task, cancellation_task, lease_lost_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if cancellation_task in done and cancellation.is_set():
                handler_task.cancel()
                await asyncio.gather(handler_task, return_exceptions=True)
                await self._send_terminal("cancel", claimed, {})
                return
            if lease_lost_task in done and lease_lost.is_set():
                handler_task.cancel()
                await asyncio.gather(handler_task, return_exceptions=True)
                return
            output = await handler_task
            validated = definition.output_model.model_validate(output)
            await self._send_terminal(
                "complete",
                claimed,
                {"value": validated.model_dump(mode="json", by_alias=True)},
            )
        except asyncio.CancelledError:
            handler_task.cancel()
            raise
        except Exception as error:  # noqa: BLE001 - handler errors become durable failures
            application_error = (
                error
                if isinstance(error, ApplicationError)
                else ApplicationError(str(error))
            )
            await self._send_terminal(
                "fail",
                claimed,
                {
                    "errorType": application_error.error_type,
                    "errorMessage": str(application_error)[:2000],
                    "nonRetryable": application_error.non_retryable,
                },
                FailureResponse,
            )
        finally:
            for task in (renewal_task, cancellation_task, lease_lost_task):
                task.cancel()
            await asyncio.gather(
                renewal_task,
                cancellation_task,
                lease_lost_task,
                return_exceptions=True,
            )

    async def _send_terminal(
        self,
        path: str,
        claimed: ClaimedActivity,
        values: dict[str, object],
        response_model: type[TerminalResponse] = TerminalResponse,
    ) -> TerminalResponse | None:
        request_id = str(uuid.uuid4())
        delay = 0.25
        while _now_ms() < claimed.schedule_deadline and not self._stopping.is_set():
            try:
                body = await self._request(
                    path,
                    {
                        "activityId": claimed.activity_id,
                        "attempt": claimed.attempt,
                        "leaseToken": claimed.lease_token,
                        "requestId": request_id,
                        **values,
                    },
                )
                return response_model.model_validate(body)
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001
                print(f"Unable to report terminal activity state {claimed.activity_id}: {error}")
                await asyncio.sleep(delay)
                delay = min(5.0, delay * 2)
        return None

    async def _request(self, path: str, body: dict[str, object]) -> Any:
        if self._client is None:
            raise RuntimeError("Worker is not started")
        response = await self._client.post(self.api_url + path, json=body)
        response.raise_for_status()
        return response.json()


def _activity_key(name: str, version: int) -> str:
    return f"{name}:{version}"


def _now_ms() -> float:
    return time.time() * 1000


def _without_none(values: dict[str, object]) -> dict[str, object]:
    return {key: value for key, value in values.items() if value is not None}
