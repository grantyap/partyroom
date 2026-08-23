import { describe, expect, test } from "vitest";
import {
  lrclibSearchCandidates,
  lrclibSearchTitle,
  normalizeLrclibTimedLyrics,
  parseLyricsfile,
  parseSyncedLyrics,
  rankLrclibMatches,
  retryAfterMilliseconds,
  suggestLyricsOffsetMs,
} from "./lrclib";

function lrclibRecord(
  id: number,
  trackName: string,
  artistName: string,
  overrides: Partial<Parameters<typeof rankLrclibMatches>[0][number]> = {},
) {
  return {
    id,
    trackName,
    artistName,
    albumName: "Example Album",
    duration: 131,
    instrumental: false,
    syncedLyrics: "[00:01.00] Example",
    lyricsfile: null,
    ...overrides,
  };
}

describe("LRCLIB lyric normalization", () => {
  test("parses LRC timestamps and derives each line duration", () => {
    expect(
      parseSyncedLyrics(
        "[00:06.35] First line\n[00:08.630] Second line\n\n[00:10.87] Third line\n[00:12.00] ",
        14,
      ),
    ).toEqual([
      { time: 6.35, duration: 2.28, value: "First line" },
      { time: 8.63, duration: 2.24, value: "Second line" },
      { time: 10.87, duration: 3.13, value: "Third line" },
    ]);
  });

  test("uses four seconds for the final line when track duration is unavailable", () => {
    expect(parseSyncedLyrics("[01:02.5] Last line")).toEqual([
      { time: 62.5, duration: 4, value: "Last line" },
    ]);
  });

  test("parses Lyricsfile words and applies its global offset", () => {
    expect(
      parseLyricsfile(`
version: "1.0"
metadata:
  title: Example
  artist: Artist
  offset_ms: 100
lines:
  - text: Hello world
    start_ms: 1000
    end_ms: 1800
    words:
      - text: "Hello "
        start_ms: 1000
      - text: world
        start_ms: 1400
`),
    ).toEqual({
      timing: "word",
      observations: [
        { time: 1.1, duration: 0.4, value: "Hello" },
        { time: 1.5, duration: 0.4, value: "world" },
      ],
    });
  });

  test("uses Lyricsfile line timing when word timing is unavailable", () => {
    expect(
      parseLyricsfile(`
version: "1.0"
metadata:
  title: Example
  artist: Artist
lines:
  - text: First line
    start_ms: 2000
    end_ms: 3500
`),
    ).toEqual({
      timing: "line",
      observations: [{ time: 2, duration: 1.5, value: "First line" }],
    });
  });

  test("rejects malformed Lyricsfile so legacy synced lyrics can be used", () => {
    expect(parseLyricsfile("version: [not valid")).toBeNull();
  });

  test("prefers word-timed Lyricsfile over legacy synced lyrics", () => {
    expect(
      normalizeLrclibTimedLyrics({
        lyricsfile: `
version: "1.0"
metadata:
  title: Example
  artist: Artist
lines:
  - text: Hello world
    start_ms: 1000
    end_ms: 1800
    words:
      - text: "Hello "
        start_ms: 1000
      - text: world
        start_ms: 1400
`,
        syncedLyrics: "[00:09.00] Legacy line",
      }),
    ).toMatchObject({
      timing: "word",
      format: "lyricsfile",
      observations: [
        { time: 1, duration: 0.4, value: "Hello" },
        { time: 1.4, duration: 0.4, value: "world" },
      ],
    });
  });

  test("falls back to legacy synced lyrics when Lyricsfile is unusable", () => {
    expect(
      normalizeLrclibTimedLyrics({
        lyricsfile: "invalid: yaml: value",
        syncedLyrics: "[00:09.00] Legacy line",
        duration: 12,
      }),
    ).toEqual({
      timing: "line",
      format: "syncedLyrics",
      observations: [{ time: 9, duration: 3, value: "Legacy line" }],
    });
  });

  test("honors numeric and HTTP-date Retry-After values", () => {
    expect(retryAfterMilliseconds("2")).toBe(2_000);
    expect(retryAfterMilliseconds("Thu, 01 Jan 2026 00:00:03 GMT", 1_767_225_600_000)).toBe(3_000);
    expect(retryAfterMilliseconds(null)).toBe(1_000);
  });

  test.each([
    ["Artist - Song (Official Music Video)", "Artist - Song"],
    ["Artist - Song [Official Audio]", "Artist - Song"],
    ["Artist - Song (Lyrics Video)", "Artist - Song"],
    ["Artist - Song (Official Visualizer)", "Artist - Song"],
    ["Artist - Song — Official Video", "Artist - Song"],
    ["Artist - Song Official MV", "Artist - Song"],
  ])("removes production labels from %s", (title, expected) => {
    expect(lrclibSearchTitle(title)).toBe(expected);
  });

  test.each([
    "Artist - Song (ft. Foo Bar)",
    "Artist - Song (feat. Foo Bar)",
    "Artist - Song (Foo Bar Remix)",
    "Artist - Song (Live at Foo Bar)",
  ])("preserves meaningful version information in %s", (title) => {
    expect(lrclibSearchTitle(title)).toBe(title);
  });

  test("extracts bounded structured and keyword candidates from a music-video title", () => {
    expect(
      lrclibSearchCandidates({
        title: "ENHYPEN (엔하이픈) 'Bloody Paradise' Official MV",
      }),
    ).toEqual([
      { trackName: "Bloody Paradise", artistName: "ENHYPEN" },
      { query: "ENHYPEN Bloody Paradise" },
      { query: "Bloody Paradise" },
    ]);
  });

  test("prioritizes structured source metadata over display-title parsing", () => {
    const candidates = lrclibSearchCandidates({
      title: "A deliberately unhelpful upload title",
      trackName: "Bloody Paradise",
      artistName: "ENHYPEN",
      albumName: "THE SIN : BLISS",
    });
    expect(candidates[0]).toEqual({
      trackName: "Bloody Paradise",
      artistName: "ENHYPEN",
      albumName: "THE SIN : BLISS",
    });
    expect(candidates[1]).toEqual({ query: "ENHYPEN Bloody Paradise" });
  });

  test("selects the correct identity and prefers word timing among equivalent records", () => {
    const wordTimed = lrclibRecord(2, "Bloody Paradise", "ENHYPEN", {
      lyricsfile: `
version: "1.0"
metadata: {}
lines:
  - text: Example
    start_ms: 1000
    words:
      - text: Example
        start_ms: 1000
        end_ms: 1500
`,
    });
    const match = rankLrclibMatches(
      [
        lrclibRecord(1, "Bloody Paradise", "ENHYPEN"),
        wordTimed,
        lrclibRecord(3, "Paradise", "Another Artist"),
      ],
      {
        candidates: [{ trackName: "Bloody Paradise", artistName: "ENHYPEN" }],
        duration: 131,
      },
    );
    expect(match?.record.id).toBe(2);
    expect(match?.wordTimed).toBe(true);
  });

  test("rejects unrelated and ambiguous search results", () => {
    expect(
      rankLrclibMatches([lrclibRecord(1, "Different Song", "Different Artist")], {
        candidates: [{ trackName: "Bloody Paradise", artistName: "ENHYPEN" }],
        duration: 131,
      }),
    ).toBeUndefined();

    expect(
      rankLrclibMatches(
        [lrclibRecord(2, "Home", "First Artist"), lrclibRecord(3, "Home", "Second Artist")],
        { candidates: [{ query: "Home" }], duration: 131 },
      ),
    ).toBeUndefined();
  });

  test("penalizes conflicting version qualifiers", () => {
    const match = rankLrclibMatches(
      [
        lrclibRecord(1, "Drowning", "Example Artist"),
        lrclibRecord(2, "Drowning (Avicii Remix)", "Example Artist"),
      ],
      {
        candidates: [{ trackName: "Drowning (Avicii Remix)", artistName: "Example Artist" }],
        duration: 131,
      },
    );
    expect(match?.record.id).toBe(2);
  });

  test("suggests a stable offset from matching line prefixes", () => {
    const reference = [
      { time: 5, value: "You know I want you" },
      { time: 10, value: "It is not a secret" },
      { time: 15, value: "I know you want me" },
    ];
    const generated = reference.flatMap((line) =>
      line.value.split(" ").map((value, index) => ({
        time: line.time + 10 + index * 0.2,
        value,
      })),
    );
    expect(suggestLyricsOffsetMs(reference, generated)).toBe(10_000);
  });

  test("does not suggest an offset without three agreeing lyric lines", () => {
    expect(
      suggestLyricsOffsetMs(
        [
          { time: 5, value: "Only one matching line" },
          { time: 10, value: "Nothing else agrees here" },
        ],
        [
          { time: 15, value: "Only" },
          { time: 15.2, value: "one" },
          { time: 15.4, value: "matching" },
          { time: 15.6, value: "line" },
        ],
      ),
    ).toBeNull();
  });

  test("suggests an offset from word-timed reference lyrics", () => {
    const reference = ["You", "know", "I", "want", "you", "here"].map((value, index) => ({
      time: 5 + index * 0.2,
      value,
    }));
    const generated = reference.map(({ time, value }) => ({ time: time + 8, value }));
    expect(suggestLyricsOffsetMs(reference, generated, "word")).toBe(8_000);
  });
});
