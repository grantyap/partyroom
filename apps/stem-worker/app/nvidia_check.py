"""Fail fast when the NVIDIA stem worker cannot access CUDA through ONNX Runtime."""

import onnxruntime
import torch


providers = onnxruntime.get_available_providers()
if not torch.cuda.is_available():
    raise SystemExit(
        "PyTorch CUDA is unavailable; refusing to start a CPU-only NVIDIA stem worker."
    )
if "CUDAExecutionProvider" not in providers:
    raise SystemExit(
        "CUDAExecutionProvider is unavailable; refusing to start a CPU-only "
        f"NVIDIA stem worker. Available providers: {', '.join(providers)}"
    )

print(
    "NVIDIA stem worker is using "
    f"{torch.cuda.get_device_name(0)} through ONNX Runtime CUDAExecutionProvider",
    flush=True,
)
