import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

os.environ.setdefault("ACTIVITY_WORKER_API_URL", "http://activities.test/workers/")
os.environ.setdefault("ACTIVITY_WORKER_TOKEN", "test-token")
os.environ.setdefault("WORK_DIR", "/tmp/partyroom-lyrics-tests")

from app.aligner import AlignedWord  # noqa: E402
from app.alignment import align_to_artifact, preserve_transcript_timing  # noqa: E402


class FakeAligner:
    def align(
        self,
        *,
        audio: tuple[object, int],
        text: str,
        language: str,
    ) -> list[AlignedWord]:
        if text != "Accurate LRCLIB lyrics" or language != "English":
            raise AssertionError("Unexpected forced-alignment input")
        return [
            AlignedWord(text="Accurate", start_time=1.0, end_time=1.4),
            AlignedWord(text="lyrics", start_time=1.8, end_time=2.2),
        ]


class AlignmentTest(unittest.TestCase):
    def test_child_import_preserves_current_work_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work_directory = Path(directory) / "work"
            attempt_directory = work_directory / "activity-1"
            attempt_directory.mkdir(parents=True)
            transcript = attempt_directory / "lrclib.txt"
            transcript.write_text("Accurate LRCLIB lyrics", encoding="utf-8")
            environment = {
                **os.environ,
                "WORK_DIR": str(work_directory),
            }

            subprocess.run(
                [sys.executable, "-c", "import app.alignment_process"],
                check=True,
                env=environment,
            )

            self.assertEqual(
                transcript.read_text(encoding="utf-8"),
                "Accurate LRCLIB lyrics",
            )

    def test_writes_normalized_word_timing_from_lrclib_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "aligned.json"
            with (
                patch(
                    "app.alignment.load_mono_audio",
                    return_value=(np.zeros(16_000, dtype=np.float32), 16_000),
                ),
            ):
                align_to_artifact(
                    Path(directory) / "vocals.flac",
                    output,
                    "Accurate LRCLIB lyrics",
                    "English",
                    threading.Event(),
                    aligner=FakeAligner(),
                    aligner_model="forced-aligner",
                )
            document = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(document["language"], "English")
        self.assertEqual(document["provenance"]["asrModel"], "provided-transcript")
        self.assertEqual(
            [observation["value"] for observation in document["observations"]],
            ["Accurate", "LRCLIB", "lyrics"],
        )
        self.assertTrue(
            all(
                observation["duration"] > 0
                for observation in document["observations"]
            )
        )
        self.assertAlmostEqual(document["observations"][1]["time"], 1.4)
        self.assertAlmostEqual(document["observations"][1]["duration"], 0.4)

    def test_repairs_zero_duration_words_without_changing_source_text(self) -> None:
        result = preserve_transcript_timing(
            "Don't drop punctuation!",
            [
                AlignedWord(text="Don't", start_time=1.0, end_time=1.0),
                AlignedWord(text="drop", start_time=1.5, end_time=1.7),
                AlignedWord(text="punctuation", start_time=1.8, end_time=1.8),
            ],
        )

        self.assertEqual(
            [word.value for word in result],
            ["Don't", "drop", "punctuation!"],
        )
        self.assertTrue(all(word.duration > 0 for word in result))


if __name__ == "__main__":
    unittest.main()
