import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("ACTIVITY_WORKER_API_URL", "http://activities.test/workers/")
os.environ.setdefault("ACTIVITY_WORKER_TOKEN", "test-token")
os.environ.setdefault("WORK_DIR", "/tmp/partyroom-lyrics-tests")

from app.main import PROGRESS_PREFIX, run_transcription  # noqa: E402


class FakeContext:
    def __init__(self) -> None:
        self.progress: list[tuple[float, str | None]] = []
        self.command: tuple[str, ...] | None = None

    async def report_progress(
        self, progress: float, message: str | None = None
    ) -> None:
        self.progress.append((progress, message))

    async def run_process(self, *command: str, **options: object) -> None:
        self.command = command
        callback = options["on_stdout_line"]
        await callback(  # type: ignore[operator]
            PROGRESS_PREFIX + json.dumps({"stage": "loadingModel"})
        )
        await callback(  # type: ignore[operator]
            PROGRESS_PREFIX + json.dumps({"completed": 1, "total": 2})
        )
        Path(command[-1]).write_text(
            json.dumps({"language": "English"}), encoding="utf-8"
        )


class TranscriptionProcessTest(unittest.IsolatedAsyncioTestCase):
    async def test_child_import_preserves_current_work_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work_directory = Path(directory) / "work"
            attempt_directory = work_directory / "activity-1"
            attempt_directory.mkdir(parents=True)
            transcript = attempt_directory / "generated.txt"
            transcript.write_text("Generated lyrics", encoding="utf-8")

            subprocess.run(
                [sys.executable, "-c", "import app.transcription_process"],
                check=True,
                env={**os.environ, "WORK_DIR": str(work_directory)},
            )

            self.assertEqual(
                transcript.read_text(encoding="utf-8"),
                "Generated lyrics",
            )

    async def test_managed_child_reports_progress_and_language(self) -> None:
        context = FakeContext()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            language = await run_transcription(
                context,  # type: ignore[arg-type]
                root / "vocals.flac",
                root / "lyrics.vtt",
                root / "timed-lyrics.json",
            )

        self.assertEqual(language, "English")
        self.assertEqual(context.command[1:3], ("-m", "app.transcription_process"))
        self.assertEqual(
            context.progress,
            [
                (0.375, "Loading Qwen/Qwen3-ASR-0.6B"),
                (0.625, "Transcribed and aligned chunk 1 of 2"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
