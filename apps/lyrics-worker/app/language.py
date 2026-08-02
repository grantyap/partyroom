from functools import lru_cache
from typing import Any


QWEN_LANGUAGE_NAMES = {
    "de": "German",
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "it": "Italian",
    "ja": "Japanese",
    "ko": "Korean",
    "pt": "Portuguese",
    "ru": "Russian",
    "zh": "Chinese",
}
CANTONESE_MARKERS = frozenset("嘅咗喺唔佢哋冇啲咁係")


@lru_cache(maxsize=1)
def _detector() -> Any:
    from py3langid.langid import LanguageIdentifier, MODEL_FILE

    detector = LanguageIdentifier.from_pickled_model(MODEL_FILE, norm_probs=True)
    detector.set_languages(list(QWEN_LANGUAGE_NAMES))
    return detector


def detect_alignment_language(transcript: str) -> str:
    if not transcript.strip():
        raise ValueError("Lyrics transcript is empty")
    if sum(character in CANTONESE_MARKERS for character in transcript) >= 2:
        return "Cantonese"
    language_code, _confidence = _detector().classify(transcript)
    language = QWEN_LANGUAGE_NAMES.get(language_code)
    if language is None:
        raise ValueError(f"Unsupported lyrics language: {language_code}")
    return language
