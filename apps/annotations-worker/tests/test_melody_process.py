import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from app import melody_process


class MelodyProcessTest(unittest.TestCase):
    def test_cli_writes_analysis_to_requested_path(self) -> None:
        with (
            patch.object(sys, "argv", ["melody_process", "vocals.flac", "melody.json"]),
            patch.object(melody_process, "write_melody_analysis") as write,
        ):
            melody_process.main()

        write.assert_called_once()
        self.assertEqual(
            write.call_args.args,
            (Path("vocals.flac"), Path("melody.json")),
        )
        progress = write.call_args.kwargs["stage_changed"]
        with patch("builtins.print") as output:
            progress("decoded")
        self.assertIn('"stage": "decoded"', output.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
