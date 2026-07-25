import json
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class TimedLyric:
    time: float
    duration: float
    value: str
    confidence: float | None = None


def build_timed_lyrics(
    lyrics: list[TimedLyric],
    *,
    language: str | None,
    asr_model: str,
    aligner_model: str,
) -> str:
    document = {
        "schemaVersion": 1,
        "language": language,
        "provenance": {
            "asrModel": asr_model,
            "alignerModel": aligner_model,
        },
        "observations": [
            asdict(lyric)
            for lyric in lyrics
            if lyric.value.strip() and lyric.time >= 0 and lyric.duration > 0
        ],
    }
    return json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
