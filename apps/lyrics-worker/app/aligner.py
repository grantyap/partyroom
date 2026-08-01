from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class AlignedWord:
    text: str
    start_time: float
    end_time: float


class ForcedAligner(Protocol):
    def align(
        self,
        *,
        audio: tuple[Any, int],
        text: str,
        language: str,
    ) -> list[AlignedWord]: ...


def resolve_pytorch_device(requested_device: str) -> tuple[str, Any]:
    import torch

    device = (
        "cuda:0"
        if requested_device == "auto" and torch.cuda.is_available()
        else requested_device
    )
    if device == "auto":
        device = "cpu"
    dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
    return device, dtype


class MlxForcedAligner:
    def __init__(self, *, model: str) -> None:
        from mlx_qwen3_asr import ForcedAligner

        self._aligner = ForcedAligner(model)

    def align(
        self,
        *,
        audio: tuple[Any, int],
        text: str,
        language: str,
    ) -> list[AlignedWord]:
        samples, sample_rate = audio
        if sample_rate != 16_000:
            raise ValueError("MLX forced alignment requires 16 kHz audio")
        return [
            AlignedWord(
                text=str(word.text),
                start_time=float(word.start_time),
                end_time=float(word.end_time),
            )
            for word in self._aligner.align(samples, text, language)
        ]


class PytorchForcedAligner:
    def __init__(self, *, model: str, device: str) -> None:
        from qwen_asr import Qwen3ForcedAligner

        resolved_device, dtype = resolve_pytorch_device(device)
        self._aligner = Qwen3ForcedAligner.from_pretrained(
            model,
            dtype=dtype,
            device_map=resolved_device,
        )

    def align(
        self,
        *,
        audio: tuple[Any, int],
        text: str,
        language: str,
    ) -> list[AlignedWord]:
        return [
            AlignedWord(
                text=str(word.text),
                start_time=float(word.start_time),
                end_time=float(word.end_time),
            )
            for word in self._aligner.align(
                audio=audio,
                text=text,
                language=language,
            )[0]
        ]


def create_aligner(
    backend: str,
    *,
    model: str,
    device: str = "auto",
) -> ForcedAligner:
    if backend == "mlx":
        return MlxForcedAligner(model=model)
    if backend != "pytorch":
        raise ValueError(f"Unsupported lyrics backend: {backend}")
    return PytorchForcedAligner(model=model, device=device)
