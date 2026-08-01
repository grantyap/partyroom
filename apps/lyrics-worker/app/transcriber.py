from dataclasses import dataclass
from typing import Any, Protocol

from .aligner import AlignedWord, resolve_pytorch_device


@dataclass(frozen=True)
class Transcription:
    language: str | None
    time_stamps: list[AlignedWord]


class Transcriber(Protocol):
    def transcribe(
        self,
        *,
        audio: tuple[Any, int],
        language: str | None,
        return_time_stamps: bool,
    ) -> list[Any]: ...

class MlxTranscriber:
    def __init__(
        self,
        *,
        asr_model: str,
        aligner_model: str,
        max_new_tokens: int,
    ) -> None:
        from mlx_qwen3_asr import ForcedAligner, Session

        self._session = Session(model=asr_model)
        self._aligner = ForcedAligner(aligner_model)
        self._max_new_tokens = max_new_tokens

    def transcribe(
        self,
        *,
        audio: tuple[Any, int],
        language: str | None,
        return_time_stamps: bool,
    ) -> list[Transcription]:
        result = self._session.transcribe(
            audio,
            language=language,
            return_timestamps=return_time_stamps,
            forced_aligner=self._aligner if return_time_stamps else None,
            max_new_tokens=self._max_new_tokens,
        )
        words = [
            AlignedWord(
                text=str(segment.get("text", "")),
                start_time=float(segment.get("start", 0)),
                end_time=float(segment.get("end", 0)),
            )
            for segment in (result.segments or [])
        ]
        return [
            Transcription(
                language=str(result.language) if result.language else None,
                time_stamps=words,
            )
        ]

class PytorchTranscriber:
    def __init__(
        self,
        *,
        asr_model: str,
        aligner_model: str,
        max_new_tokens: int,
        device: str,
    ) -> None:
        from qwen_asr import Qwen3ASRModel

        resolved_device, dtype = resolve_pytorch_device(device)
        self._model = Qwen3ASRModel.from_pretrained(
            asr_model,
            dtype=dtype,
            device_map=resolved_device,
            max_inference_batch_size=1,
            max_new_tokens=max_new_tokens,
            forced_aligner=aligner_model,
            forced_aligner_kwargs={"dtype": dtype, "device_map": device},
        )

    def transcribe(
        self,
        *,
        audio: tuple[Any, int],
        language: str | None,
        return_time_stamps: bool,
    ) -> list[Any]:
        return self._model.transcribe(
            audio=audio,
            language=language,
            return_time_stamps=return_time_stamps,
        )

def create_transcriber(
    backend: str,
    *,
    asr_model: str,
    aligner_model: str,
    max_new_tokens: int,
    device: str = "auto",
) -> Transcriber:
    if backend == "mlx":
        return MlxTranscriber(
            asr_model=asr_model,
            aligner_model=aligner_model,
            max_new_tokens=max_new_tokens,
        )
    if backend != "pytorch":
        raise ValueError(f"Unsupported lyrics backend: {backend}")
    return PytorchTranscriber(
        asr_model=asr_model,
        aligner_model=aligner_model,
        max_new_tokens=max_new_tokens,
        device=device,
    )
