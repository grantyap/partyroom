import json
import sys
import threading
from pathlib import Path

from .aligner import create_aligner
from .alignment import align_to_artifact


def emit_progress(stage: str) -> None:
    print(
        "partyroom-progress:" + json.dumps({"stage": stage}, ensure_ascii=False),
        flush=True,
    )


def main() -> None:
    if len(sys.argv) != 8:
        raise SystemExit(
            "usage: python -m app.alignment_process "
            "AUDIO TRANSCRIPT LYRICS LANGUAGE BACKEND MODEL DEVICE"
        )
    audio_path = Path(sys.argv[1])
    transcript_path = Path(sys.argv[2])
    lyrics_path = Path(sys.argv[3])
    language = sys.argv[4]
    backend = sys.argv[5]
    model = sys.argv[6]
    device = sys.argv[7]
    emit_progress("loadingModel")
    aligner = create_aligner(backend, model=model, device=device)
    align_to_artifact(
        audio_path,
        lyrics_path,
        transcript_path.read_text(encoding="utf-8"),
        language,
        threading.Event(),
        aligner=aligner,
        aligner_model=model,
        stage_changed=emit_progress,
    )


if __name__ == "__main__":
    main()
