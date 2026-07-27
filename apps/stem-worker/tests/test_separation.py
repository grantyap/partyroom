import sys
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import app.cpu_separator as cpu_separator
from app.separation import run_separator
from app.progress_separator import PROGRESS_PREFIX
from partyroom_activity_worker import ApplicationError, ManagedProcessResult


class SeparationTest(unittest.IsolatedAsyncioTestCase):
    def test_cpu_cli_replaces_separator_at_the_module_import_point(self):
        original_separator = cpu_separator.separator_module.Separator
        try:
            with patch.object(cpu_separator.cli, "main") as cli_main:
                cpu_separator.main()

            cli_main.assert_called_once_with()
            self.assertIs(
                cpu_separator.separator_module.Separator,
                cpu_separator.CPUSeparator,
            )
        finally:
            cpu_separator.separator_module.Separator = original_separator

    async def test_retries_coreml_inference_failure_on_cpu(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            partial_output = directory / "instrumental.flac"
            partial_output.write_bytes(b"partial")
            context = AsyncMock()
            context.run_process.side_effect = [
                ApplicationError(
                    "audio-separator exited with 1: "
                    "CoreMLExecutionProvider: Error executing model"
                ),
                ManagedProcessResult(0, b"ok", b""),
            ]

            result = await run_separator(
                context,
                directory / "input.wav",
                "model.onnx",
                directory / "models",
                directory,
            )

            self.assertEqual(result.returncode, 0)
            self.assertFalse(partial_output.exists())
            self.assertEqual(context.run_process.await_count, 2)
            retry_command = context.run_process.await_args_list[1].args
            self.assertEqual(
                retry_command[:3], (sys.executable, "-m", "app.cpu_separator")
            )
            context.report_progress.assert_awaited_once()

    async def test_does_not_retry_unrelated_failure(self):
        context = AsyncMock()
        failure = ApplicationError("audio-separator exited with 1: invalid input")
        context.run_process.side_effect = failure

        with self.assertRaises(ApplicationError) as raised:
            await run_separator(
                context,
                Path("input.wav"),
                "model.onnx",
                Path("models"),
                Path("."),
            )

        self.assertIs(raised.exception, failure)
        context.run_process.assert_awaited_once()
        context.report_progress.assert_not_awaited()

    async def test_reports_structured_separator_chunk_progress(self):
        context = AsyncMock()

        async def report(completed, total):
            await context.report_progress(
                0.5 + 0.125 * completed / total,
                f"Separating stems: pass 1, chunk {completed} of {total}",
            )

        context.progress_reporter = MagicMock(return_value=report)

        async def run_process(*_command, **options):
            await options["on_stdout_line"](
                PROGRESS_PREFIX
                + json.dumps({"pass": 1, "completed": 2, "total": 4})
            )
            return ManagedProcessResult(0, b"", b"")

        context.run_process.side_effect = run_process
        await run_separator(
            context,
            Path("input.wav"),
            "model.onnx",
            Path("models"),
            Path("."),
        )

        context.report_progress.assert_awaited_once_with(
            0.5625, "Separating stems: pass 1, chunk 2 of 4"
        )


if __name__ == "__main__":
    unittest.main()
