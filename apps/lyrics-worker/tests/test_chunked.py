import threading
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.chunked import (
    TranscriptionCancelled,
    cleanup_stale_work,
    transcribe_audio_chunks,
)


@dataclass
class Item:
    text: str
    start_time: float
    end_time: float


@dataclass
class Result:
    language: str
    time_stamps: list[Item]


class FakeModel:
    def __init__(self, cancelled: threading.Event | None = None) -> None:
        self.calls: list[tuple[int, str | None]] = []
        self.cancelled = cancelled

    def transcribe(self, *, audio, language, return_time_stamps):
        samples, _sample_rate = audio
        self.calls.append((len(samples), language))
        if self.cancelled is not None:
            self.cancelled.set()
        return [Result("English", [Item("word", 1, 2)])]


class ChunkedTranscriptionTest(unittest.TestCase):
    def test_transcribes_sequential_chunks_and_offsets_timestamps(self) -> None:
        cancelled = threading.Event()
        model = FakeModel()
        completed: list[tuple[int, int]] = []

        language, words = transcribe_audio_chunks(
            model,
            np.zeros(1_300, dtype=np.float32),
            sample_rate=10,
            chunk_seconds=60,
            cancelled=cancelled,
            chunk_completed=lambda current, total: completed.append((current, total)),
        )

        self.assertEqual(language, "English")
        self.assertEqual(model.calls, [(600, None), (600, "English"), (100, "English")])
        self.assertEqual([word.start for word in words], [1, 61, 121])
        self.assertEqual(completed, [(1, 3), (2, 3), (3, 3)])

    def test_stops_between_chunks_when_cancelled(self) -> None:
        cancelled = threading.Event()
        model = FakeModel(cancelled)

        with self.assertRaises(TranscriptionCancelled):
            transcribe_audio_chunks(
                model,
                np.zeros(1_300, dtype=np.float32),
                sample_rate=10,
                chunk_seconds=60,
                cancelled=cancelled,
            )

        self.assertEqual(len(model.calls), 1)

    def test_cleans_stale_attempt_files_on_worker_start(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "work"
            attempt = root / "activity-1"
            attempt.mkdir(parents=True)
            (attempt / "vocals.flac").write_bytes(b"stale")
            (root / ".lyrics.vtt.tmp").write_text("partial", encoding="utf-8")

            cleanup_stale_work(root)

            self.assertEqual(list(root.iterdir()), [])

if __name__ == "__main__":
    unittest.main()
