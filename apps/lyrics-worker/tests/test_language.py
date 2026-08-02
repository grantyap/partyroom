import unittest

from app.language import detect_alignment_language


class LanguageTest(unittest.TestCase):
    def test_detects_supported_lyrics_languages(self) -> None:
        self.assertEqual(
            detect_alignment_language(
                "I know that you are here and I will always sing this song for you"
            ),
            "English",
        )
        self.assertEqual(
            detect_alignment_language(
                "No quiero perderte porque esta canción siempre será para ti"
            ),
            "Spanish",
        )
        self.assertEqual(
            detect_alignment_language("Я знаю что ты здесь и эта песня всегда для тебя"),
            "Russian",
        )
        self.assertEqual(
            detect_alignment_language("我哋喺呢度唱歌，佢哋唔會忘記"),
            "Cantonese",
        )


if __name__ == "__main__":
    unittest.main()
