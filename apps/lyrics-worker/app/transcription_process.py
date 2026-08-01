import json
import sys
import threading
from pathlib import Path

from .chunked import write_text_atomic
from .transcriber import create_transcriber
from .transcription import transcribe_to_artifacts


PROGRESS_PREFIX = "partyroom-progress:"


def main() -> None:
    if len(sys.argv) != 11:
        raise SystemExit(
            "usage: python -m app.transcription_process "
            "BACKEND ASR_MODEL ALIGNER_MODEL MAX_NEW_TOKENS CHUNK_SECONDS DEVICE "
            "INPUT VTT LYRICS RESULT"
        )
    backend, asr_model, aligner_model = sys.argv[1:4]
    max_new_tokens = int(sys.argv[4])
    chunk_seconds = int(sys.argv[5])
    device = sys.argv[6]
    input_path, vtt_path, lyrics_path, result_path = map(Path, sys.argv[7:])

    def progress(completed: int, total: int) -> None:
        print(
            PROGRESS_PREFIX
            + json.dumps({"completed": completed, "total": total}),
            flush=True,
        )

    def stage_changed(stage: str) -> None:
        print(
            PROGRESS_PREFIX + json.dumps({"stage": stage}),
            flush=True,
        )

    stage_changed("loadingModel")
    transcriber = create_transcriber(
        backend,
        asr_model=asr_model,
        aligner_model=aligner_model,
        max_new_tokens=max_new_tokens,
        device=device,
    )
    language = transcribe_to_artifacts(
        input_path,
        vtt_path,
        lyrics_path,
        threading.Event(),
        transcriber=transcriber,
        asr_model=asr_model,
        aligner_model=aligner_model,
        chunk_seconds=chunk_seconds,
        chunk_completed=progress,
        stage_changed=stage_changed,
    )
    write_text_atomic(
        result_path,
        json.dumps({"language": language}, ensure_ascii=False) + "\n",
    )


if __name__ == "__main__":
    main()
