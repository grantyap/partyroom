import json
import sys
import threading
from pathlib import Path

from .aligner import create_aligner
from .alignment import alignment_lines_from_arrays, align_to_artifact
from .chunked import write_text_atomic
from .language import detect_alignment_language


def emit_progress(stage: str, **fields: int) -> None:
    print(
        "partyroom-progress:"
        + json.dumps({"stage": stage, **fields}, ensure_ascii=False),
        flush=True,
    )


def main() -> None:
    if len(sys.argv) != 8:
        raise SystemExit(
            "usage: python -m app.alignment_process "
            "BACKEND MODEL DEVICE AUDIO INPUT LYRICS RESULT"
        )
    backend = sys.argv[1]
    model = sys.argv[2]
    device = sys.argv[3]
    audio_path = Path(sys.argv[4])
    input_path = Path(sys.argv[5])
    lyrics_path = Path(sys.argv[6])
    result_path = Path(sys.argv[7])
    alignment_input = json.loads(input_path.read_text(encoding="utf-8"))
    lines = alignment_lines_from_arrays(
        alignment_input["lines"],
        alignment_input["lineStarts"],
        alignment_input["lineEnds"],
    )
    transcript = "\n".join(line.text for line in lines)
    emit_progress("detectingLanguage")
    language = detect_alignment_language(transcript)
    emit_progress("loadingModel")
    aligner = create_aligner(backend, model=model, device=device)
    align_to_artifact(
        audio_path,
        lyrics_path,
        lines,
        language,
        threading.Event(),
        aligner=aligner,
        aligner_model=model,
        chunk_completed=lambda completed, total: emit_progress(
            "alignedChunk",
            completed=completed,
            total=total,
        ),
        stage_changed=emit_progress,
    )
    write_text_atomic(
        result_path,
        json.dumps({"language": language}, ensure_ascii=False) + "\n",
    )


if __name__ == "__main__":
    main()
