import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

import jams
import mido

from app.exporters import build_jams, write_midi, write_musicxml


LYRICS = {
    "schemaVersion": 1,
    "provenance": {"asrModel": "fixture-asr", "alignerModel": "fixture-aligner"},
    "observations": [
        {"time": 0.5, "duration": 0.4, "value": "Hel", "confidence": 0.93}
    ],
}
MELODY = {
    "schemaVersion": 1,
    "provenance": {"model": "fixture-model", "version": "1.0"},
    "notes": [{"time": 0.48, "duration": 0.86, "midi": 64.25, "confidence": 0.88}],
    "pitchContour": [
        {"time": 0.48, "frequency": 329.1, "voiced": True, "confidence": 0.96},
        {"time": 0.50, "frequency": 0, "voiced": False, "confidence": 0.1},
    ],
}


class ExportersTest(unittest.TestCase):
    def test_jams_validates_with_official_library(self) -> None:
        jam = build_jams(
            LYRICS,
            MELODY,
            duration=4,
            title="Fixture",
            extractor="fixture",
            source_id="source",
        )
        jam.validate(strict=True)
        self.assertEqual(
            [annotation.namespace for annotation in jam.annotations],
            ["lyrics", "note_midi", "pitch_contour"],
        )
        self.assertEqual(jam.search(namespace="note_midi")[0].data[0].value, 64.25)
        self.assertEqual(
            jam.search(namespace="pitch_contour")[0].sandbox.provenance["model"],
            "fixture-model",
        )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "annotations.jams"
            jam.save(str(path), strict=True)
            saved = jams.load(str(path), strict=True)

        self.assertEqual(
            [annotation.namespace for annotation in saved.annotations],
            ["lyrics", "note_midi", "pitch_contour"],
        )

    def test_exports_valid_deterministic_midi_and_musicxml(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            midi_path = root / "guide.mid"
            xml_path = root / "guide.musicxml"
            write_midi(MELODY["notes"], LYRICS["observations"], midi_path)
            write_musicxml(
                MELODY["notes"],
                LYRICS["observations"],
                duration=4,
                title="Fixture",
                path=xml_path,
            )

            midi = mido.MidiFile(midi_path)
            self.assertTrue(any(message.type == "lyrics" for message in midi.tracks[0]))
            self.assertTrue(
                any(message.type == "pitchwheel" for message in midi.tracks[0])
            )
            xml = ET.parse(xml_path)
            self.assertEqual(xml.getroot().tag, "score-partwise")
            self.assertEqual(xml.findtext(".//lyric/text"), "Hel")
            first = xml_path.read_bytes()
            write_musicxml(
                MELODY["notes"],
                LYRICS["observations"],
                duration=4,
                title="Fixture",
                path=xml_path,
            )
            self.assertEqual(xml_path.read_bytes(), first)


if __name__ == "__main__":
    unittest.main()
