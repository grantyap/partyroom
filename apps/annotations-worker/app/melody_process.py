import json
import sys
from pathlib import Path

from .melody import write_melody_analysis


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m app.melody_process INPUT OUTPUT")
    def stage_changed(stage: str) -> None:
        print(
            "partyroom-progress:" + json.dumps({"stage": stage}),
            flush=True,
        )

    write_melody_analysis(
        Path(sys.argv[1]), Path(sys.argv[2]), stage_changed=stage_changed
    )


if __name__ == "__main__":
    main()
