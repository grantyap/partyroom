import os
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.separator_server import (
    _enable_concurrent_audio_writes,
    _progress_iterator,
    _separator_options,
    _skip_unused_audio_separator_match_pass,
)


class SeparatorServerTest(unittest.TestCase):
    def test_reports_each_progress_item(self):
        events = []
        reporting_tqdm = _progress_iterator(events.append)

        self.assertEqual(list(reporting_tqdm(["a", "b"])), ["a", "b"])
        self.assertEqual(
            events,
            [
                {
                    "type": "progress",
                    "pass": 1,
                    "completed": 1,
                    "total": 2,
                },
                {
                    "type": "progress",
                    "pass": 1,
                    "completed": 2,
                    "total": 2,
                },
            ],
        )

    def test_configures_fast_overlap_and_batch_size(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.dict(
                os.environ,
                {"STEM_MDX_OVERLAP": "0.1", "STEM_MDX_BATCH_SIZE": "2"},
            ),
        ):
            options = _separator_options(
                Path(directory) / "models", Path(directory) / "output"
            )

        self.assertEqual(options["mdx_params"]["overlap"], 0.1)
        self.assertEqual(options["mdx_params"]["batch_size"], 2)

    def test_rejects_invalid_overlap(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.dict(os.environ, {"STEM_MDX_OVERLAP": "1"}),
            self.assertRaisesRegex(ValueError, "STEM_MDX_OVERLAP"),
        ):
            _separator_options(Path(directory) / "models", Path(directory) / "output")

    def test_skips_discarded_match_mix_pass(self):
        from audio_separator.separator.architectures.mdx_separator import MDXSeparator

        original = MDXSeparator.demix
        try:
            _skip_unused_audio_separator_match_pass()
            mix = object()
            separator = SimpleNamespace(invert_using_spec=False)
            self.assertIs(MDXSeparator.demix(separator, mix, is_match_mix=True), mix)
        finally:
            MDXSeparator.demix = original

    def test_writes_audio_stems_concurrently(self):
        barrier = threading.Barrier(2)
        written = []

        class ModelInstance:
            def final_process(self, stem_path, _source, _stem_name):
                barrier.wait(timeout=1)
                written.append(stem_path)

            def separate(self):
                self.final_process("instrumental.flac", object(), "Instrumental")
                self.final_process("vocals.flac", object(), "Vocals")
                return ["instrumental.flac", "vocals.flac"]

        separator = SimpleNamespace(model_instance=ModelInstance())
        _enable_concurrent_audio_writes(separator, 2)

        outputs = separator.model_instance.separate()

        self.assertEqual(outputs, ["instrumental.flac", "vocals.flac"])
        self.assertCountEqual(written, outputs)


if __name__ == "__main__":
    unittest.main()
