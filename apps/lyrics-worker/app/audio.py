import math
from pathlib import Path
from typing import Any


def load_mono_audio(audio_path: Path) -> tuple[Any, int]:
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly

    audio, sample_rate = sf.read(audio_path, dtype="float32", always_2d=True)
    mono = np.mean(audio, axis=1, dtype=np.float32)
    del audio
    target_sample_rate = 16_000
    if sample_rate != target_sample_rate:
        divisor = math.gcd(sample_rate, target_sample_rate)
        mono = resample_poly(
            mono,
            target_sample_rate // divisor,
            sample_rate // divisor,
        ).astype(np.float32, copy=False)
    return mono, target_sample_rate
