import json
import sys
import threading
from pathlib import Path

from .aligner import create_aligner
from .alignment import align_to_artifact
from .chunked import write_text_atomic
from .language import detect_alignment_language


def emit_progress(stage: str) -> None:
    print(
        "partyroom-progress:" + json.dumps({"stage": stage}, ensure_ascii=False),
        flush=True,
    )


def main() -> None:
    if len(sys.argv) != 8:
        raise SystemExit(
            "usage: python -m app.alignment_process "
            "BACKEND MODEL DEVICE AUDIO TRANSCRIPT LYRICS RESULT"
        )
    backend = sys.argv[1]
    model = sys.argv[2]
    device = sys.argv[3]
    audio_path = Path(sys.argv[4])
    transcript_path = Path(sys.argv[5])
    lyrics_path = Path(sys.argv[6])
    result_path = Path(sys.argv[7])
    transcript = transcript_path.read_text(encoding="utf-8")
    emit_progress("detectingLanguage")
    language = detect_alignment_language(transcript)
    emit_progress("loadingModel")
    aligner = create_aligner(backend, model=model, device=device)
    align_to_artifact(
        audio_path,
        lyrics_path,
        transcript,
        language,
        threading.Event(),
        aligner=aligner,
        aligner_model=model,
        stage_changed=emit_progress,
    )
    write_text_atomic(
        result_path,
        json.dumps({"language": language}, ensure_ascii=False) + "\n",
    )


if __name__ == "__main__":
    main()
