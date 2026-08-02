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
from app.alignment import (  # noqa: E402
    AlignmentLine,
    align_to_artifact,
    alignment_lines_from_arrays,
    build_alignment_chunks,
    preserve_transcript_timing,
)


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


class ChunkRecordingAligner:
    def __init__(self) -> None:
        self.calls: list[tuple[int, str]] = []

    def align(
        self,
        *,
        audio: tuple[object, int],
        text: str,
        language: str,
    ) -> list[AlignedWord]:
        samples, _sample_rate = audio
        self.calls.append((len(samples), text))
        return [
            AlignedWord(
                text=token,
                start_time=1 + index * 0.25,
                end_time=1.2 + index * 0.25,
            )
            for index, token in enumerate(text.split())
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
                    [AlignmentLine("Accurate LRCLIB lyrics", 0, 4)],
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

    def test_aligns_long_audio_in_overlapping_line_owned_chunks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "aligned.json"
            aligner = ChunkRecordingAligner()
            lines = [
                AlignmentLine("same chorus", 10, 20),
                AlignmentLine("same chorus", 260, 270),
                AlignmentLine("same chorus", 510, 520),
                AlignmentLine("same chorus", 760, 770),
            ]
            with patch(
                "app.alignment.load_mono_audio",
                return_value=(np.zeros(800, dtype=np.float32), 1),
            ):
                align_to_artifact(
                    Path(directory) / "vocals.flac",
                    output,
                    lines,
                    "English",
                    threading.Event(),
                    aligner=aligner,
                    aligner_model="forced-aligner",
                )
            document = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(len(aligner.calls), 4)
        self.assertTrue(all(samples <= 300 for samples, _text in aligner.calls))
        self.assertTrue(any(text.count("same chorus") == 2 for _, text in aligner.calls))
        self.assertEqual(
            [observation["value"] for observation in document["observations"]],
            ["same", "chorus"] * 4,
        )
        times = [observation["time"] for observation in document["observations"]]
        self.assertEqual(times, sorted(times))

    def test_builds_bounded_chunks_across_arbitrarily_long_timing(self) -> None:
        lines = [
            AlignmentLine("first", 10, 20),
            AlignmentLine("second", 260, 270),
            AlignmentLine("third", 510, 520),
            AlignmentLine("fourth", 760, 770),
        ]

        chunks = build_alignment_chunks(lines, 800)

        self.assertEqual(
            [(chunk.core_start, chunk.core_end) for chunk in chunks],
            [(0, 1), (1, 2), (2, 3), (3, 4)],
        )
        self.assertTrue(
            all(
                0 < chunk.audio_end - chunk.audio_start <= 300
                for chunk in chunks
            )
        )
        self.assertGreater(chunks[-1].audio_end, 700)

    def test_validates_parallel_line_arrays(self) -> None:
        self.assertEqual(
            alignment_lines_from_arrays(["line"], [1.0], [2.0]),
            [AlignmentLine("line", 1.0, 2.0)],
        )
        with self.assertRaisesRegex(ValueError, "equal lengths"):
            alignment_lines_from_arrays(["line"], [1.0], [])

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
