import json
import unittest

from app.structured import TimedLyric, build_timed_lyrics


class StructuredLyricsTest(unittest.TestCase):
    def test_builds_deterministic_timed_observations_with_provenance(self) -> None:
        result = json.loads(
            build_timed_lyrics(
                [TimedLyric(time=1.25, duration=0.5, value="Hello", confidence=0.9)],
                language="English",
                asr_model="asr/model",
                aligner_model="aligner/model",
            )
        )

        self.assertEqual(result["schemaVersion"], 1)
        self.assertEqual(result["language"], "English")
        self.assertEqual(result["provenance"]["asrModel"], "asr/model")
        self.assertEqual(
            result["observations"][0],
            {"time": 1.25, "duration": 0.5, "value": "Hello", "confidence": 0.9},
        )


if __name__ == "__main__":
    unittest.main()
