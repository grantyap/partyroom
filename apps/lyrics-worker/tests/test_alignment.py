import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

os.environ.setdefault("ACTIVITY_WORKER_API_URL", "http://activities.test/workers/")
os.environ.setdefault("ACTIVITY_WORKER_TOKEN", "test-token")
os.environ.setdefault("WORK_DIR", "/tmp/partyroom-lyrics-tests")

from app.main import align_to_artifact  # noqa: E402


class FakeAligner:
    def align(
        self,
        *,
        audio: tuple[object, int],
        text: str,
        language: str,
    ) -> list[object]:
        if text != "Accurate LRCLIB lyrics" or language != "English":
            raise AssertionError("Unexpected forced-alignment input")
        return [
            SimpleNamespace(text="Accurate", start_time=1.0, end_time=1.5),
            SimpleNamespace(text="lyrics", start_time=1.5, end_time=2.0),
        ]


class AlignmentTest(unittest.TestCase):
    def test_writes_normalized_word_timing_from_lrclib_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "aligned.json"
            with (
                patch(
                    "app.main.load_mono_audio",
                    return_value=(np.zeros(16_000, dtype=np.float32), 16_000),
                ),
                patch("app.main.get_model", return_value=FakeAligner()),
            ):
                align_to_artifact(
                    Path(directory) / "vocals.flac",
                    output,
                    "Accurate LRCLIB lyrics",
                    "English",
                    threading.Event(),
                )
            document = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(document["language"], "English")
        self.assertEqual(document["provenance"]["asrModel"], "LRCLIB")
        self.assertEqual(
            document["observations"],
            [
                {
                    "confidence": None,
                    "duration": 0.5,
                    "time": 1.0,
                    "value": "Accurate",
                },
                {
                    "confidence": None,
                    "duration": 0.5,
                    "time": 1.5,
                    "value": "lyrics",
                },
            ],
        )


if __name__ == "__main__":
    unittest.main()
