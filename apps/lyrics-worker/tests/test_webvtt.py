import unittest

from app.webvtt import TimedWord, build_webvtt, format_timestamp


class WebVttTest(unittest.TestCase):
    def test_formats_open_karaoke_timestamps(self) -> None:
        result = build_webvtt(
            [TimedWord("Hello", 1, 1.5), TimedWord("world", 1.6, 2.2)],
            "English",
        )
        self.assertIn("WEBVTT", result)
        self.assertIn("00:00:01.000 --> 00:00:02.200", result)
        self.assertIn("Hello<00:00:01.600> world", result)

    def test_escapes_cue_text_and_splits_long_lines(self) -> None:
        words = [TimedWord(f"word-{index}<", index, index + 0.5) for index in range(10)]
        result = build_webvtt(words)
        self.assertIn("&lt;", result)
        self.assertEqual(result.count(" --> "), 2)

    def test_formats_hours(self) -> None:
        self.assertEqual(format_timestamp(3661.234), "01:01:01.234")


if __name__ == "__main__":
    unittest.main()
