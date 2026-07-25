import json
import os
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
            PROGRESS_PREFIX + json.dumps({"completed": 1, "total": 2})
        )
        Path(command[-1]).write_text(
            json.dumps({"language": "English"}), encoding="utf-8"
        )


class TranscriptionProcessTest(unittest.IsolatedAsyncioTestCase):
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
            [(0.5, "Transcribed and aligned chunk 1 of 2")],
        )


if __name__ == "__main__":
    unittest.main()
