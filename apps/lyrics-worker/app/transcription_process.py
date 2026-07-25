import json
import os
import sys
import threading
from pathlib import Path

os.environ["LYRICS_PROCESS_CHILD"] = "1"

from .chunked import write_text_atomic  # noqa: E402
from .main import transcribe_to_artifacts  # noqa: E402


PROGRESS_PREFIX = "partyroom-progress:"


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit(
            "usage: python -m app.transcription_process INPUT VTT LYRICS RESULT"
        )
    input_path, vtt_path, lyrics_path, result_path = map(Path, sys.argv[1:])

    def progress(completed: int, total: int) -> None:
        print(
            PROGRESS_PREFIX
            + json.dumps({"completed": completed, "total": total}),
            flush=True,
        )

    language = transcribe_to_artifacts(
        input_path,
        vtt_path,
        lyrics_path,
        threading.Event(),
        progress,
    )
    write_text_atomic(
        result_path,
        json.dumps({"language": language}, ensure_ascii=False) + "\n",
    )


if __name__ == "__main__":
    main()
