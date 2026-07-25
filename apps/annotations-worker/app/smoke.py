import argparse
import json
from pathlib import Path

from .melody import analyze_audio


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run real melody inference on a short vocal fixture"
    )
    parser.add_argument(
        "audio", type=Path, help="Licensed or synthetic isolated-vocal audio"
    )
    parser.add_argument("--output", type=Path, default=Path("melody-smoke.json"))
    args = parser.parse_args()
    analysis = analyze_audio(args.audio)
    args.output.write_text(
        json.dumps(analysis, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"wrote {len(analysis['notes'])} notes and "
        f"{len(analysis['pitchContour'])} pitch frames to {args.output}"
    )


if __name__ == "__main__":
    main()
