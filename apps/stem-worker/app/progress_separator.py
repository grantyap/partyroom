"""Run audio-separator while emitting machine-readable inference progress."""

import json
from collections.abc import Iterable, Iterator
from typing import Any, TypeVar

from audio_separator.utils import cli


Item = TypeVar("Item")
PROGRESS_PREFIX = "partyroom-progress:"
_pass_number = 0


def reporting_tqdm(
    iterable: Iterable[Item] | None = None, *args: Any, **kwargs: Any
) -> Iterator[Item]:
    """Minimal tqdm-compatible iterator for audio-separator inference loops."""
    global _pass_number
    if iterable is None:
        return iter(())
    _pass_number += 1
    pass_number = _pass_number
    total = int(kwargs.get("total") or len(iterable))  # type: ignore[arg-type]

    def iterate() -> Iterator[Item]:
        for completed, item in enumerate(iterable, start=1):
            yield item
            print(
                PROGRESS_PREFIX
                + json.dumps(
                    {
                        "pass": pass_number,
                        "completed": completed,
                        "total": total,
                    }
                ),
                flush=True,
            )

    return iterate()


def install_progress_reporting() -> None:
    # Architectures import tqdm into module scope, so patch those local bindings.
    from audio_separator.separator.architectures import (
        mdx_separator,
        mdxc_separator,
        vr_separator,
    )

    mdx_separator.tqdm = reporting_tqdm
    mdxc_separator.tqdm = reporting_tqdm
    vr_separator.tqdm = reporting_tqdm


def main() -> None:
    install_progress_reporting()
    cli.main()


if __name__ == "__main__":
    main()
