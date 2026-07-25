import math
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import jams
import mido


def build_jams(
    lyrics: dict[str, Any],
    melody: dict[str, Any],
    *,
    duration: float,
    title: str | None,
    extractor: str,
    source_id: str,
) -> jams.JAMS:
    jam = jams.JAMS()
    jam.file_metadata.duration = duration
    jam.file_metadata.title = title or ""
    jam.file_metadata.identifiers = {"extractor": extractor, "sourceId": source_id}
    jam.sandbox.partyroom = {
        "profile": "partyroom-karaoke",
        "version": 1,
        "jamsVersion": jams.__version__,
    }

    lyric_annotation = jams.Annotation(namespace="lyrics")
    lyric_annotation.annotation_metadata.data_source = "program"
    lyric_annotation.annotation_metadata.annotator = {
        "name": "Partyroom lyrics worker",
        "email": "",
    }
    lyric_annotation.annotation_metadata.version = str(lyrics.get("schemaVersion", 1))
    lyric_annotation.annotation_metadata.corpus = ""
    lyric_annotation.annotation_metadata.curator = {
        "name": str(lyrics.get("provenance", {}).get("asrModel", "unknown")),
        "email": "",
    }
    lyric_annotation.sandbox.provenance = lyrics.get("provenance", {})
    for observation in lyrics.get("observations", []):
        lyric_annotation.append(
            time=float(observation["time"]),
            duration=float(observation["duration"]),
            value=str(observation["value"]),
            confidence=observation.get("confidence"),
        )
    jam.annotations.append(lyric_annotation)

    provenance = melody.get("provenance", {})
    for namespace in ("note_midi", "pitch_contour"):
        annotation = jams.Annotation(namespace=namespace)
        annotation.annotation_metadata.data_source = "program"
        annotation.annotation_metadata.annotator = {
            "name": str(provenance.get("model", "unknown")),
            "email": "",
        }
        annotation.annotation_metadata.version = str(
            provenance.get("version", "unknown")
        )
        annotation.annotation_metadata.annotation_tools = str(
            provenance.get("model", "unknown")
        )
        annotation.sandbox.provenance = provenance
        if namespace == "note_midi":
            for note in melody.get("notes", []):
                annotation.append(
                    time=float(note["time"]),
                    duration=float(note["duration"]),
                    value=float(note["midi"]),
                    confidence=note.get("confidence"),
                )
        else:
            for index, frame in enumerate(melody.get("pitchContour", [])):
                annotation.append(
                    time=float(frame["time"]),
                    duration=0,
                    value={
                        "index": index,
                        "frequency": float(frame["frequency"]),
                        "voiced": bool(frame["voiced"]),
                    },
                    confidence=frame.get("confidence"),
                )
        jam.annotations.append(annotation)

    jam.validate(strict=True)
    return jam


def write_midi(
    notes: list[dict[str, Any]], lyrics: list[dict[str, Any]], path: Path
) -> None:
    midi = mido.MidiFile(type=1, ticks_per_beat=480)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    tempo = mido.bpm2tempo(120)
    track.append(mido.MetaMessage("track_name", name="Vocal guide", time=0))
    track.append(mido.MetaMessage("set_tempo", tempo=tempo, time=0))

    events: list[tuple[float, int, mido.Message | mido.MetaMessage]] = []
    for lyric in lyrics:
        events.append(
            (
                float(lyric["time"]),
                0,
                mido.MetaMessage("lyrics", text=str(lyric["value"])),
            )
        )
    for note in notes:
        start = float(note["time"])
        end = start + float(note["duration"])
        pitch = float(note["midi"])
        base_pitch = min(127, max(0, round(pitch)))
        bend = round(max(-1.0, min(1.0, (pitch - base_pitch) / 2)) * 8191)
        velocity = round(40 + 60 * float(note.get("confidence") or 0.5))
        events.extend(
            [
                (start, 1, mido.Message("pitchwheel", pitch=bend, channel=0)),
                (
                    start,
                    2,
                    mido.Message(
                        "note_on", note=base_pitch, velocity=velocity, channel=0
                    ),
                ),
                (
                    end,
                    0,
                    mido.Message("note_off", note=base_pitch, velocity=0, channel=0),
                ),
                (end, 1, mido.Message("pitchwheel", pitch=0, channel=0)),
            ]
        )

    previous_tick = 0
    for seconds, _order, message in sorted(
        events, key=lambda event: (event[0], event[1])
    ):
        tick = round(mido.second2tick(seconds, midi.ticks_per_beat, tempo))
        message.time = max(0, tick - previous_tick)
        track.append(message)
        previous_tick = tick
    track.append(mido.MetaMessage("end_of_track", time=0))
    midi.save(path)


_PITCH_NAMES = [
    ("C", 0),
    ("C", 1),
    ("D", 0),
    ("D", 1),
    ("E", 0),
    ("F", 0),
    ("F", 1),
    ("G", 0),
    ("G", 1),
    ("A", 0),
    ("A", 1),
    ("B", 0),
]


def _append_duration_note(
    measure: ET.Element,
    *,
    duration: int,
    midi_pitch: float | None,
    tie_start: bool = False,
    tie_stop: bool = False,
    lyric: str | None = None,
) -> None:
    note = ET.SubElement(measure, "note")
    if midi_pitch is None:
        ET.SubElement(note, "rest")
    else:
        rounded = round(midi_pitch)
        step, accidental = _PITCH_NAMES[rounded % 12]
        pitch = ET.SubElement(note, "pitch")
        ET.SubElement(pitch, "step").text = step
        alter = accidental + (midi_pitch - rounded)
        if not math.isclose(alter, 0, abs_tol=0.0001):
            ET.SubElement(pitch, "alter").text = f"{alter:.4f}".rstrip("0").rstrip(".")
        ET.SubElement(pitch, "octave").text = str(rounded // 12 - 1)
    ET.SubElement(note, "duration").text = str(duration)
    ET.SubElement(note, "voice").text = "1"
    if tie_stop:
        ET.SubElement(note, "tie", type="stop")
    if tie_start:
        ET.SubElement(note, "tie", type="start")
    if tie_start or tie_stop:
        notations = ET.SubElement(note, "notations")
        if tie_stop:
            ET.SubElement(notations, "tied", type="stop")
        if tie_start:
            ET.SubElement(notations, "tied", type="start")
    if lyric:
        lyric_element = ET.SubElement(note, "lyric", number="1")
        ET.SubElement(lyric_element, "syllabic").text = "single"
        ET.SubElement(lyric_element, "text").text = lyric


def write_musicxml(
    notes: list[dict[str, Any]],
    lyrics: list[dict[str, Any]],
    *,
    duration: float,
    title: str | None,
    path: Path,
) -> None:
    divisions = 1000
    measure_ticks = divisions * 4
    root = ET.Element("score-partwise", version="4.0")
    ET.SubElement(root, "work")
    root.find("work").append(ET.Element("work-title"))  # type: ignore[union-attr]
    root.find("work/work-title").text = title or "Vocal guide"  # type: ignore[union-attr]
    part_list = ET.SubElement(root, "part-list")
    score_part = ET.SubElement(part_list, "score-part", id="P1")
    ET.SubElement(score_part, "part-name").text = "Voice"
    part = ET.SubElement(root, "part", id="P1")

    measures: dict[int, ET.Element] = {}
    cursors: dict[int, int] = {}

    def require_measure(index: int) -> ET.Element:
        if index not in measures:
            measure = ET.SubElement(part, "measure", number=str(index + 1))
            measures[index] = measure
            cursors[index] = 0
            if index == 0:
                attributes = ET.SubElement(measure, "attributes")
                ET.SubElement(attributes, "divisions").text = str(divisions)
                time = ET.SubElement(attributes, "time")
                ET.SubElement(time, "beats").text = "4"
                ET.SubElement(time, "beat-type").text = "4"
                clef = ET.SubElement(attributes, "clef")
                ET.SubElement(clef, "sign").text = "G"
                ET.SubElement(clef, "line").text = "2"
                direction = ET.SubElement(measure, "direction", placement="above")
                sound = ET.SubElement(direction, "sound")
                sound.set("tempo", "60")
            return measure
        return measures[index]

    lyric_used: set[int] = set()
    timeline: list[tuple[int, int, float | None, str | None, bool, bool]] = []
    current_tick = 0
    for note in sorted(notes, key=lambda item: float(item["time"])):
        start = max(current_tick, round(float(note["time"]) * divisions))
        end = max(
            start + 1,
            round((float(note["time"]) + float(note["duration"])) * divisions),
        )
        if start > current_tick:
            timeline.append((current_tick, start, None, None, False, False))
        lyric_text = None
        for index, lyric in enumerate(lyrics):
            if index in lyric_used:
                continue
            lyric_start = float(lyric["time"])
            lyric_end = lyric_start + float(lyric["duration"])
            if lyric_start < end / divisions and lyric_end > start / divisions:
                lyric_text = str(lyric["value"])
                lyric_used.add(index)
                break
        segment_start = start
        first = True
        while segment_start < end:
            boundary = ((segment_start // measure_ticks) + 1) * measure_ticks
            segment_end = min(end, boundary)
            timeline.append(
                (
                    segment_start,
                    segment_end,
                    float(note["midi"]),
                    lyric_text if first else None,
                    segment_end < end,
                    not first,
                )
            )
            first = False
            segment_start = segment_end
        current_tick = end
    total_ticks = max(current_tick, round(duration * divisions))
    if total_ticks > current_tick:
        timeline.append((current_tick, total_ticks, None, None, False, False))

    for start, end, midi_pitch, lyric, tie_start, tie_stop in timeline:
        cursor = start
        while cursor < end:
            measure_index = cursor // measure_ticks
            measure = require_measure(measure_index)
            local_start = cursor % measure_ticks
            if cursors[measure_index] < local_start:
                _append_duration_note(
                    measure,
                    duration=local_start - cursors[measure_index],
                    midi_pitch=None,
                )
            segment_end = min(end, (measure_index + 1) * measure_ticks)
            _append_duration_note(
                measure,
                duration=segment_end - cursor,
                midi_pitch=midi_pitch,
                tie_start=tie_start or segment_end < end,
                tie_stop=tie_stop or cursor > start,
                lyric=lyric if cursor == start else None,
            )
            cursors[measure_index] = segment_end % measure_ticks or measure_ticks
            cursor = segment_end

    if not measures:
        require_measure(0)
    ET.indent(root, space="  ")
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)
