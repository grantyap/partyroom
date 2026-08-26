"""Async controller for the persistent separator subprocess."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from collections import deque
from pathlib import Path
from typing import Any

from partyroom_activity_worker import ActivityContext, ApplicationError


class SeparatorRuntime:
    def __init__(self) -> None:
        self._process: asyncio.subprocess.Process | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._stderr: deque[str] = deque(maxlen=200)
        self._lock = asyncio.Lock()
        self._diagnostics: dict[str, Any] = {
            "backend": os.getenv("STEM_BACKEND", "audio-separator"),
            "state": "stopped",
        }

    @property
    def diagnostics(self) -> dict[str, Any]:
        return dict(self._diagnostics)

    async def start(self) -> None:
        async with self._lock:
            try:
                await self._ensure_started()
            except BaseException:
                await self.stop()
                raise

    async def _read_stderr(self, stream: asyncio.StreamReader) -> None:
        while line := await stream.readline():
            text = line.decode(errors="replace").rstrip()
            self._stderr.append(text)
            print(text, file=sys.stderr, flush=True)

    async def _read_event(self) -> dict[str, Any]:
        process = self._process
        if process is None or process.stdout is None:
            raise RuntimeError("Separator process is not running")
        line = await process.stdout.readline()
        if not line:
            details = "\n".join(self._stderr)[-8000:]
            raise ApplicationError(
                f"Persistent separator exited unexpectedly: {details}"
            )
        return json.loads(line)

    async def _ensure_started(self) -> None:
        if self._process is not None and self._process.returncode is None:
            return
        self._diagnostics["state"] = "starting"
        self._stderr.clear()
        self._process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "app.separator_server",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        assert self._process.stderr is not None
        self._stderr_task = asyncio.create_task(
            self._read_stderr(self._process.stderr), name="stem-separator-stderr"
        )
        event = await self._read_event()
        if event.get("type") != "ready":
            await self.stop()
            raise ApplicationError(
                f"Unable to start persistent separator: {event.get('message', event)}"
            )
        self._diagnostics = {**event, "state": "ready"}

    async def separate(
        self, context: ActivityContext, input_path: Path, output_dir: Path
    ) -> None:
        async with self._lock:
            try:
                await self._ensure_started()
                process = self._process
                assert process is not None and process.stdin is not None
                request = {
                    "type": "separate",
                    "inputPath": str(input_path),
                    "outputDir": str(output_dir),
                }
                process.stdin.write((json.dumps(request) + "\n").encode())
                await process.stdin.drain()

                reporters = {}
                started_at = time.perf_counter()
                while True:
                    event = await self._read_event()
                    event_type = event.get("type")
                    if event_type == "complete":
                        self._diagnostics["lastSeparationSeconds"] = round(
                            time.perf_counter() - started_at, 3
                        )
                        return
                    if event_type == "error":
                        raise ApplicationError(
                            "Stem separation failed: "
                            + str(event.get("message", "unknown error"))
                            + "\n"
                            + str(event.get("traceback", ""))[-6000:]
                        )
                    if event_type != "progress":
                        continue
                    completed = int(event["completed"])
                    total = int(event["total"])
                    pass_number = max(1, int(event.get("pass", 1)))
                    reporter = reporters.setdefault(
                        pass_number,
                        context.progress_reporter(
                            0.02,
                            0.98,
                            lambda done, count: (
                                f"Separating stems: chunk {done} of {count}"
                            ),
                        ),
                    )
                    await reporter(completed, total)
            except BaseException:
                await self.stop()
                raise

    async def stop(self) -> None:
        process, self._process = self._process, None
        stderr_task, self._stderr_task = self._stderr_task, None
        if process is not None and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=5)
            except TimeoutError:
                process.kill()
                await process.wait()
        if stderr_task is not None:
            if not stderr_task.done():
                stderr_task.cancel()
            await asyncio.gather(stderr_task, return_exceptions=True)
        self._diagnostics["state"] = "stopped"
