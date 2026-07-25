# Partyroom annotations worker

This service owns the heavy vocal-melody analysis and the deterministic
annotation export stage. `analyzeMelody` turns an isolated vocal FLAC into a
versioned note/pitch intermediate. `assembleAnnotations` combines that result
with structured lyric observations and uploads validated JAMS, Standard MIDI,
and MusicXML artifacts.

The initial backend is `librosa.pyin`. It is a reproducible CPU baseline, not a
permanent catalog model choice. Its identity, version, and parameters are
recorded in the intermediate and copied into JAMS metadata. Keep the backend
boundary stable while evaluating GAME against Basic Pitch on representative
licensed separated vocals; changing the backend then only requires a cache
version bump and a converter to the same `notes`/`pitchContour` shape.

Ordinary tests use tiny in-memory golden observations and never download a
model. To run real inference on a short licensed or synthetic vocal fixture:

```sh
uv sync --locked
uv run python -m app.smoke /path/to/short-vocal.wav --output melody-smoke.json
```

The JAMS output uses only the standard `lyrics`, `note_midi`, and
`pitch_contour` namespaces. Lyrics and notes share the absolute media timeline;
no proprietary syllable-to-note relation is added.
