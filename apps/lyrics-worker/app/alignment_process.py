import json
import sys
import threading
from pathlib import Path

from .main import align_to_artifact


def emit_progress(stage: str) -> None:
    print(
        "partyroom-progress:" + json.dumps({"stage": stage}, ensure_ascii=False),
        flush=True,
    )


def main() -> None:
    audio_path = Path(sys.argv[1])
    transcript_path = Path(sys.argv[2])
    lyrics_path = Path(sys.argv[3])
    language = sys.argv[4]
    align_to_artifact(
        audio_path,
        lyrics_path,
        transcript_path.read_text(encoding="utf-8"),
        language,
        threading.Event(),
        stage_changed=emit_progress,
    )


if __name__ == "__main__":
    main()
