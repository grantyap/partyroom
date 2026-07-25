import sys
from pathlib import Path

from .melody import write_melody_analysis


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m app.melody_process INPUT OUTPUT")
    write_melody_analysis(Path(sys.argv[1]), Path(sys.argv[2]))


if __name__ == "__main__":
    main()
