import { describe, expect, test } from "bun:test";
import {
  findKaraokeCue,
  karaokeWordProgress,
  lyricsIntoCues,
  parseJamsDocument,
  parseKaraokeJams,
  parseLyricObservations,
} from "./karaoke";

const jamsDocument = (annotations: unknown[]) => ({
  file_metadata: {
    identifiers: { sourceId: "fixture" },
    artist: "Artist",
    title: "Song",
    release: "",
    duration: 180,
    jams_version: "0.3.5",
  },
  annotations,
  sandbox: { partyroom: { profile: "partyroom-karaoke" } },
});

describe("karaoke timing", () => {
  test("parses structured timed lyrics and ignores invalid observations", () => {
    expect(
      parseLyricObservations({
        observations: [
          { time: 1, duration: 0.4, value: " Hello ", confidence: 0.9 },
          { time: -1, duration: 1, value: "invalid" },
          { time: 2, duration: 0, value: "invalid" },
        ],
      }),
    ).toEqual([{ time: 1, duration: 0.4, value: "Hello", confidence: 0.9 }]);
  });

  test("parses the lyrics namespace from JAMS annotations", () => {
    expect(
      parseLyricObservations(
        jamsDocument([
          { namespace: "note_midi", data: [] },
          {
            namespace: "lyrics",
            data: [{ time: 2, duration: 0.5, value: "Mosquito" }],
          },
        ]),
      ),
    ).toEqual([{ time: 2, duration: 0.5, value: "Mosquito" }]);
  });

  test("rejects malformed JAMS documents and skips namespace-invalid values", () => {
    expect(parseLyricObservations({ annotations: "invalid" })).toEqual([]);
    expect(
      parseLyricObservations(
        jamsDocument([
          {
            namespace: "lyrics",
            data: [
              { time: 2, duration: 1, value: 42 },
              { time: 3, duration: 0.5, value: " Valid " },
            ],
          },
        ]),
      ),
    ).toEqual([{ time: 3, duration: 0.5, value: "Valid" }]);
  });

  test("parses core JAMS metadata and karaoke-relevant namespaces", () => {
    const document = jamsDocument([
      {
        namespace: "lyrics",
        time: 0,
        duration: 180,
        annotation_metadata: {
          data_source: "program",
          annotator: { name: "fixture-aligner" },
        },
        sandbox: { provenance: { model: "fixture" } },
        data: [
          { time: 2, duration: 0, value: "event", confidence: null },
          { time: 2.1, duration: 0.4, value: "Sing", confidence: 0.9 },
        ],
      },
      {
        namespace: "note_midi",
        data: [{ time: 2, duration: 0.5, value: 64.25, confidence: 0.8 }],
      },
      {
        namespace: "pitch_contour",
        data: {
          time: [2],
          duration: [0],
          value: [{ index: 0, frequency: 329.6, voiced: true }],
          confidence: [0.95],
        },
      },
      {
        namespace: "beat_position",
        data: [
          {
            time: 2,
            duration: 0,
            value: { position: 1, measure: 2, num_beats: 4, beat_units: 4 },
          },
        ],
      },
      {
        namespace: "segment_open",
        data: [{ time: 0, duration: 20, value: "intro" }],
      },
      {
        namespace: "tempo",
        data: [{ time: 0, duration: 180, value: 120, confidence: 0.8 }],
      },
      {
        namespace: "key_mode",
        data: [{ time: 0, duration: 180, value: "C:major" }],
      },
      {
        namespace: "chord",
        data: [{ time: 0, duration: 2, value: "C:maj" }],
      },
    ]);

    expect(parseJamsDocument(document)?.file_metadata.title).toBe("Song");
    const karaoke = parseKaraokeJams(document)!;
    expect(karaoke.lyrics[0].annotation_metadata?.data_source).toBe("program");
    expect(karaoke.lyrics[0].data).toHaveLength(2);
    expect(karaoke.midiNotes[0].data[0].value).toBe(64.25);
    expect(karaoke.pitchContours[0].data[0].value.voiced).toBe(true);
    expect(karaoke.beatPositions[0].data[0].value.measure).toBe(2);
    expect(karaoke.segments[0].data[0].value).toBe("intro");
    expect(karaoke.tempos[0].data[0].value).toBe(120);
    expect(karaoke.keys[0].data[0].value).toBe("C:major");
    expect(karaoke.chords[0].data[0].value).toBe("C:maj");
    expect(parseLyricObservations(document)).toEqual([
      { time: 2.1, duration: 0.4, value: "Sing", confidence: 0.9 },
    ]);
  });

  test("rejects malformed dense JAMS annotation columns", () => {
    expect(
      parseJamsDocument(
        jamsDocument([
          {
            namespace: "pitch_contour",
            data: {
              time: [1, 2],
              duration: [0],
              value: [],
              confidence: [],
            },
          },
        ]),
      ),
    ).toBeNull();
  });

  test("groups words at sentence and timing boundaries", () => {
    const cues = lyricsIntoCues(
      [
        { time: 0, duration: 0.3, value: "One" },
        { time: 0.4, duration: 0.3, value: "two" },
        { time: 0.8, duration: 0.3, value: "three." },
        { time: 1.2, duration: 0.3, value: "Next" },
        { time: 3.5, duration: 0.3, value: "Later" },
      ],
      "word",
    );

    expect(cues.map((cue) => cue.words.map((word) => word.text))).toEqual([
      ["One", "two", "three."],
      ["Next"],
      ["Later"],
    ]);
  });

  test("normalizes line-synced lyrics into the shared cue shape", () => {
    expect(
      lyricsIntoCues(
        [
          { time: 4, duration: 2, value: " First line " },
          { time: 7, duration: 3, value: "Second line" },
        ],
        "line",
      ),
    ).toEqual([
      {
        start: 4,
        end: 6,
        words: [{ time: 4, duration: 2, text: "First line" }],
      },
      {
        start: 7,
        end: 10,
        words: [{ time: 7, duration: 3, text: "Second line" }],
      },
    ]);
  });

  test("selects cues strictly within their offset-adjusted interval", () => {
    const cues = lyricsIntoCues(
      [
        { time: 5, duration: 1, value: "First" },
        { time: 8, duration: 1, value: "Second" },
      ],
      "line",
    );

    expect(findKaraokeCue(cues, 0)).toBe(-1);
    expect(findKaraokeCue(cues, 4.999)).toBe(-1);
    expect(findKaraokeCue(cues, 5)).toBe(0);
    expect(findKaraokeCue(cues, 6)).toBe(-1);
    expect(findKaraokeCue(cues, 7)).toBe(-1);
    expect(findKaraokeCue(cues, 8)).toBe(1);
    expect(findKaraokeCue(cues, 9)).toBe(-1);
    expect(findKaraokeCue(cues, 11)).toBe(-1);
  });

  test("clamps progressive word highlighting", () => {
    const word = { time: 4, duration: 2, text: "Sing" };
    expect(karaokeWordProgress(word, 3)).toBe(0);
    expect(karaokeWordProgress(word, 5)).toBe(0.5);
    expect(karaokeWordProgress(word, 7)).toBe(1);
  });
});
