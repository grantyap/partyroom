import unittest

from app.melody import PitchFrame, frames_to_notes


class MelodyTest(unittest.TestCase):
    def test_converts_frames_to_fractional_midi_notes(self) -> None:
        frames = [PitchFrame(index * 0.02, 440.0, True, 0.9) for index in range(6)]
        notes = frames_to_notes(frames, 0.02)

        self.assertEqual(len(notes), 1)
        self.assertAlmostEqual(notes[0].time, 0)
        self.assertAlmostEqual(notes[0].duration, 0.12)
        self.assertAlmostEqual(notes[0].midi, 69.0)
        self.assertAlmostEqual(notes[0].confidence or 0, 0.9)

    def test_unvoiced_frames_split_notes(self) -> None:
        frames = [
            *[PitchFrame(index * 0.02, 440.0, True, 0.8) for index in range(5)],
            PitchFrame(0.1, 0, False, 0.1),
            *[PitchFrame(0.12 + index * 0.02, 493.88, True, 0.8) for index in range(5)],
        ]
        self.assertEqual(len(frames_to_notes(frames, 0.02)), 2)


if __name__ == "__main__":
    unittest.main()
