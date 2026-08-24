import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.aligner import resolve_pytorch_device


class PytorchDeviceTest(unittest.TestCase):
    def resolve(self, *, cuda_available: bool, bfloat16_available: bool):
        cuda = SimpleNamespace(
            is_available=lambda: cuda_available,
            is_bf16_supported=lambda: bfloat16_available,
        )
        torch = SimpleNamespace(
            cuda=cuda,
            bfloat16="bfloat16",
            float16="float16",
            float32="float32",
        )
        with patch.dict(sys.modules, {"torch": torch}):
            return resolve_pytorch_device("auto")

    def test_uses_bfloat16_on_supported_cuda_devices(self) -> None:
        self.assertEqual(
            self.resolve(cuda_available=True, bfloat16_available=True),
            ("cuda:0", "bfloat16"),
        )

    def test_uses_float16_on_older_cuda_devices(self) -> None:
        self.assertEqual(
            self.resolve(cuda_available=True, bfloat16_available=False),
            ("cuda:0", "float16"),
        )

    def test_uses_float32_without_cuda(self) -> None:
        self.assertEqual(
            self.resolve(cuda_available=False, bfloat16_available=False),
            ("cpu", "float32"),
        )


if __name__ == "__main__":
    unittest.main()
