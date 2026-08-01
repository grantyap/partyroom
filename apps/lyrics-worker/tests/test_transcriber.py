import sys
import types
import unittest
from unittest.mock import patch

from app.aligner import MlxForcedAligner, create_aligner
from app.transcriber import MlxTranscriber, create_transcriber


class FakeMlxResult:
    def __init__(self) -> None:
        self.language = "English"
        self.segments = [
            {"text": "hello", "start": 0.25, "end": 0.75},
            {"text": "world", "start": 0.8, "end": 1.2},
        ]


class FakeSession:
    def __init__(self, *, model: str) -> None:
        self.model = model
        self.request: dict[str, object] | None = None

    def transcribe(self, audio: object, **options: object) -> FakeMlxResult:
        self.request = {"audio": audio, **options}
        return FakeMlxResult()


class FakeAligner:
    def __init__(self, model: str) -> None:
        self.model = model
        self.request: tuple[object, str, str] | None = None

    def align(self, audio: object, text: str, language: str) -> list[object]:
        self.request = (audio, text, language)
        return [
            types.SimpleNamespace(
                text="LRCLIB",
                start_time=1.25,
                end_time=1.75,
            )
        ]


class TranscriberTest(unittest.TestCase):
    def test_mlx_adapter_preserves_word_timestamps(self) -> None:
        module = types.ModuleType("mlx_qwen3_asr")
        module.Session = FakeSession  # type: ignore[attr-defined]
        module.ForcedAligner = FakeAligner  # type: ignore[attr-defined]
        with patch.dict(sys.modules, {"mlx_qwen3_asr": module}):
            transcriber = MlxTranscriber(
                asr_model="asr",
                aligner_model="aligner",
                max_new_tokens=512,
            )
            result = transcriber.transcribe(
                audio=("samples", 16_000),  # type: ignore[arg-type]
                language=None,
                return_time_stamps=True,
            )[0]

        self.assertEqual(result.language, "English")
        self.assertEqual(
            [
                (word.text, word.start_time, word.end_time)
                for word in result.time_stamps
            ],
            [("hello", 0.25, 0.75), ("world", 0.8, 1.2)],
        )
        self.assertEqual(transcriber._session.request["max_new_tokens"], 512)
        self.assertIs(
            transcriber._session.request["forced_aligner"], transcriber._aligner
        )

    def test_mlx_aligner_is_independent_from_transcription(self) -> None:
        module = types.ModuleType("mlx_qwen3_asr")
        module.Session = FakeSession  # type: ignore[attr-defined]
        module.ForcedAligner = FakeAligner  # type: ignore[attr-defined]
        with patch.dict(sys.modules, {"mlx_qwen3_asr": module}):
            aligner = MlxForcedAligner(model="aligner")
            words = aligner.align(
                audio=("samples", 16_000),  # type: ignore[arg-type]
                text="LRCLIB",
                language="English",
            )

        self.assertEqual(
            [(word.text, word.start_time, word.end_time) for word in words],
            [("LRCLIB", 1.25, 1.75)],
        )
        self.assertEqual(
            aligner._aligner.request,
            ("samples", "LRCLIB", "English"),
        )

    def test_rejects_unknown_backend(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsupported lyrics backend"):
            create_transcriber(
                "unknown",
                asr_model="asr",
                aligner_model="aligner",
                max_new_tokens=512,
            )
        with self.assertRaisesRegex(ValueError, "Unsupported lyrics backend"):
            create_aligner("unknown", model="aligner")


if __name__ == "__main__":
    unittest.main()
