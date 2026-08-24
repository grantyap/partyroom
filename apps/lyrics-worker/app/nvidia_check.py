"""Fail fast when the NVIDIA lyrics worker cannot access CUDA through PyTorch."""

import torch


if not torch.cuda.is_available():
    raise SystemExit(
        "PyTorch CUDA is unavailable; refusing to start a CPU-only NVIDIA lyrics worker."
    )

print(f"NVIDIA lyrics worker is using {torch.cuda.get_device_name(0)}", flush=True)
