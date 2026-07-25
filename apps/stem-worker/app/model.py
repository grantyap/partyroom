import asyncio
import fcntl
import os
import zipfile
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Protocol


class ProcessResult(Protocol):
    stdout: bytes
    stderr: bytes


RunProcess = Callable[..., Awaitable[ProcessResult]]


def model_is_complete(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size == 0:
        return False
    if path.suffix.lower() == ".ckpt":
        return zipfile.is_zipfile(path)
    return True


async def ensure_model(
    model_dir: Path, model: str, run_process: RunProcess
) -> None:
    """Download a model completely before any separator process can load it."""
    model_path = model_dir / model
    lock_path = model_dir / f".{Path(model).name}.lock"
    model_dir.mkdir(parents=True, exist_ok=True)

    with lock_path.open("w") as lock:
        await asyncio.to_thread(fcntl.flock, lock.fileno(), fcntl.LOCK_EX)
        try:
            if model_is_complete(model_path):
                return

            # audio-separator skips downloads based only on file existence, so a
            # partial checkpoint must be removed before asking it to download.
            model_path.unlink(missing_ok=True)
            result = await run_process(
                "audio-separator",
                "--model_filename",
                model,
                "--model_file_dir",
                str(model_dir),
                "--download_model_only",
            )
            if not model_is_complete(model_path):
                output = (result.stdout + result.stderr).decode(errors="replace")
                raise RuntimeError(
                    f"audio-separator downloaded an incomplete model: {model}: "
                    f"{output[-4000:]}"
                )
        finally:
            await asyncio.to_thread(fcntl.flock, lock.fileno(), fcntl.LOCK_UN)
