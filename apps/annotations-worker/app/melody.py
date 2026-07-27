import json
import math
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class PitchFrame:
    time: float
    frequency: float
    voiced: bool
    confidence: float | None


@dataclass(frozen=True)
class Note:
    time: float
    duration: float
    midi: float
    confidence: float | None


def frequency_to_midi(frequency: float) -> float:
    return 69 + 12 * math.log2(frequency / 440)


def frames_to_notes(frames: list[PitchFrame], frame_duration: float) -> list[Note]:
    notes: list[Note] = []
    current: list[PitchFrame] = []
    current_pitch: int | None = None

    def flush() -> None:
        nonlocal current, current_pitch
        if not current:
            return
        duration = current[-1].time - current[0].time + frame_duration
        if duration >= 0.08:
            midi_values = sorted(
                frequency_to_midi(frame.frequency) for frame in current
            )
            confidences = [
                frame.confidence for frame in current if frame.confidence is not None
            ]
            notes.append(
                Note(
                    time=current[0].time,
                    duration=duration,
                    midi=midi_values[len(midi_values) // 2],
                    confidence=sum(confidences) / len(confidences)
                    if confidences
                    else None,
                )
            )
        current = []
        current_pitch = None

    for frame in frames:
        if not frame.voiced or frame.frequency <= 0:
            flush()
            continue
        pitch = round(frequency_to_midi(frame.frequency))
        contiguous = (
            not current or frame.time - current[-1].time <= frame_duration * 1.5
        )
        if current_pitch is not None and (pitch != current_pitch or not contiguous):
            flush()
        current_pitch = pitch
        current.append(frame)
    flush()
    return notes


def analyze_audio(
    audio_path: Path,
    *,
    hop_length: int = 512,
    stage_changed: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    import librosa

    sample_rate = 22_050
    audio, _ = librosa.load(audio_path, sr=sample_rate, mono=True)
    if stage_changed is not None:
        stage_changed("decoded")
    frequencies, voiced_flags, voiced_probabilities = librosa.pyin(
        audio,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C7"),
        sr=sample_rate,
        frame_length=2048,
        hop_length=hop_length,
        fill_na=0.0,
    )
    if stage_changed is not None:
        stage_changed("pitch")
    times = librosa.times_like(frequencies, sr=sample_rate, hop_length=hop_length)
    frames = [
        PitchFrame(
            time=float(time),
            frequency=float(frequency),
            voiced=bool(voiced),
            confidence=float(confidence) if math.isfinite(float(confidence)) else None,
        )
        for time, frequency, voiced, confidence in zip(
            times, frequencies, voiced_flags, voiced_probabilities, strict=True
        )
    ]
    frame_duration = hop_length / sample_rate
    notes = frames_to_notes(frames, frame_duration)
    if stage_changed is not None:
        stage_changed("notes")
    audio_duration = len(audio) / sample_rate
    bounded_notes = [
        Note(
            time=note.time,
            duration=min(note.duration, max(0, audio_duration - note.time)),
            midi=note.midi,
            confidence=note.confidence,
        )
        for note in notes
        if note.time < audio_duration
    ]
    return {
        "schemaVersion": 1,
        "provenance": {
            "model": "librosa.pyin",
            "version": librosa.__version__,
            "parameters": {
                "sampleRate": sample_rate,
                "hopLength": hop_length,
                "frameLength": 2048,
                "fmin": "C2",
                "fmax": "C7",
            },
        },
        "frameDuration": frame_duration,
        "notes": [asdict(note) for note in bounded_notes],
        "pitchContour": [asdict(frame) for frame in frames],
    }


def write_melody_analysis(
    audio_path: Path,
    output_path: Path,
    stage_changed: Callable[[str], None] | None = None,
) -> None:
    output_path.write_text(
        json.dumps(
            analyze_audio(audio_path, stage_changed=stage_changed),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    if stage_changed is not None:
        stage_changed("written")
