"""Run audio-separator with ONNX Runtime's CPU provider."""

import torch
import audio_separator.separator as separator_module
from audio_separator.utils import cli

from .progress_separator import install_progress_reporting


class CPUSeparator(separator_module.Separator):
    def setup_torch_device(self, _system_info) -> None:
        self.torch_device_cpu = torch.device("cpu")
        self.torch_device = self.torch_device_cpu
        self.onnx_execution_provider = ["CPUExecutionProvider"]
        self.logger.info(
            "CoreML fallback enabled; using ONNX Runtime CPUExecutionProvider"
        )


def main() -> None:
    # audio-separator imports this class inside cli.main(), so replace it on
    # the source module before the CLI performs that import.
    separator_module.Separator = CPUSeparator
    install_progress_reporting()
    cli.main()


if __name__ == "__main__":
    main()
