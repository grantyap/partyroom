import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.model import ensure_model, model_is_complete


def write_checkpoint(path: Path) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("data.pkl", b"checkpoint")


class ModelTest(unittest.IsolatedAsyncioTestCase):
    def test_rejects_partial_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.ckpt"
            path.write_bytes(b"PK\x03\x04partial")

            self.assertFalse(model_is_complete(path))

    async def test_keeps_complete_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.ckpt"
            write_checkpoint(path)

            run_process = AsyncMock()
            await ensure_model(Path(directory), path.name, run_process)

            run_process.assert_not_awaited()

    async def test_replaces_partial_checkpoint_before_download(self):
        with tempfile.TemporaryDirectory() as directory:
            model_dir = Path(directory)
            path = model_dir / "model.ckpt"
            path.write_bytes(b"PK\x03\x04partial")

            async def download(*_command):
                self.assertFalse(path.exists())
                write_checkpoint(path)
                return SimpleNamespace(stdout=b"downloaded", stderr=b"")

            run_process = AsyncMock(side_effect=download)
            await ensure_model(model_dir, path.name, run_process)

            self.assertTrue(model_is_complete(path))
            run_process.assert_awaited_once_with(
                "audio-separator",
                "--model_filename",
                "model.ckpt",
                "--model_file_dir",
                str(model_dir),
                "--download_model_only",
            )


if __name__ == "__main__":
    unittest.main()
