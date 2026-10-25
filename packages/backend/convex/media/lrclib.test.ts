import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  fetchLyrics,
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

describe("LRCLIB metadata fallback", () => {
  const args = { jobId: "job", title: "An unhelpful upload title", duration: 131 };
  const extractedMetadata = { artistName: "Example Artist", trackName: "Example Song" };
  const record = lrclibRecord(1, extractedMetadata.trackName, extractedMetadata.artistName);
  let http: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    http = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", http);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("returns an original success without extraction", async () => {
    http.mockImplementation(async () => Response.json([record]));
    expect(await fetchLyrics({ ...args, ...extractedMetadata })).toMatchObject({
      state: "ready",
      id: 1,
    });
    expect(http).toHaveBeenCalledTimes(1);
  });

  test("returns a normal miss without calling a model service", async () => {
    http.mockImplementation(async () => Response.json([]));
    expect(await fetchLyrics(args)).toMatchObject({ state: "not_found" });
    expect(http).toHaveBeenCalledTimes(1);
    expect(String(http.mock.calls[0][0])).toMatch(/^https:\/\/lrclib.net\/api\/search/);
  });

  test.each([503, 404])("throws on HTTP %i", async (status) => {
    http.mockImplementation(async () => Response.json({}, { status }));
    await expect(fetchLyrics(args)).rejects.toThrow(`LRCLIB search failed with HTTP ${status}`);
    expect(http).toHaveBeenCalledTimes(1);
  });

  test("throws on network failure", async () => {
    http.mockRejectedValue(new Error("network unavailable"));
    await expect(fetchLyrics(args)).rejects.toThrow("network unavailable");
  });

  test("searches only extracted candidates and caps extra searches at two", async () => {
    http.mockImplementation(async () => Response.json([]));
    expect(await fetchLyrics({ ...args, extractedMetadata })).toMatchObject({ state: "not_found" });
    expect(http).toHaveBeenCalledTimes(2);
    expect(String(http.mock.calls[0][0])).toContain("artist_name=Example+Artist");
    expect(String(http.mock.calls[1][0])).toContain("q=Example+Artist+Example+Song");
  });

  test("fills only missing source fields", async () => {
    http.mockImplementation(async () => Response.json([]));
    const source = { ...args, artistName: "Source Artist", extractedMetadata };
    await fetchLyrics(source);
    expect(String(http.mock.calls[0][0])).toContain("artist_name=Source+Artist");
    expect(source.artistName).toBe("Source Artist");
    http.mockClear();
    await fetchLyrics({ ...source, trackName: "Source Song" });
    expect(String(http.mock.calls[0][0])).toContain("track_name=Source+Song");
  });

  test.each([{}, { trackName: "Example Song" }, { artistName: "Example Artist" }])(
    "unknown extraction %j causes no searches",
    async (extractedMetadata) => {
      expect(await fetchLyrics({ ...args, extractedMetadata })).toMatchObject({
        state: "not_found",
      });
      expect(http).not.toHaveBeenCalled();
    },
  );

  test("malformed initial lyrics remain a normal miss", async () => {
    http.mockImplementation(async () => Response.json([{ ...record, syncedLyrics: "malformed" }]));
    expect(await fetchLyrics({ ...args, ...extractedMetadata })).toMatchObject({
      state: "not_found",
    });
  });

  test("malformed fallback lyrics do not outrank a valid record", async () => {
    http.mockImplementation(async () =>
      Response.json([
        { ...record, syncedLyrics: "malformed" },
        { ...record, id: 2 },
      ]),
    );
    expect(await fetchLyrics({ ...args, extractedMetadata })).toMatchObject({
      state: "ready",
      id: 2,
    });
  });

  test.each(["Remix", "Live", "Acoustic", "Sped Up"])(
    "keeps original %s evidence",
    async (version) => {
      http.mockImplementation(async () => Response.json([record]));
      expect(
        await fetchLyrics({
          ...args,
          title: `Example Artist - Example Song (${version})`,
          extractedMetadata,
        }),
      ).toMatchObject({ state: "not_found" });
    },
  );

  test.each(["(Avicii Remix)", "Avicii Remix"])("rejects a different named %s", async (version) => {
    const trackName = `The Long Example Song With Many Shared Words ${version}`;
    http.mockImplementation(async () =>
      Response.json([
        lrclibRecord(2, trackName.replace("Avicii", "Tiesto"), extractedMetadata.artistName),
      ]),
    );
    expect(
      await fetchLyrics({
        ...args,
        title: `${trackName} Official MV`,
        extractedMetadata: { ...extractedMetadata, trackName },
      }),
    ).toMatchObject({ state: "not_found" });
  });

  test("preserves a remixer name dropped by extraction", async () => {
    const trackName = "The Long Example Song With Many Shared Words";
    http.mockImplementation(async () =>
      Response.json([lrclibRecord(2, `${trackName} (Tiesto Remix)`, extractedMetadata.artistName)]),
    );
    expect(
      await fetchLyrics({
        ...args,
        title: `${extractedMetadata.artistName} ${trackName} Avicii Remix`,
        extractedMetadata: { ...extractedMetadata, trackName: `${trackName} Remix` },
      }),
    ).toMatchObject({ state: "not_found" });
  });

  test("accepts a matching version", async () => {
    const trackName = "Example Song (Live)";
    http.mockImplementation(async () =>
      Response.json([lrclibRecord(2, trackName, extractedMetadata.artistName)]),
    );
    expect(
      await fetchLyrics({
        ...args,
        title: "Example Artist Example Song (Live) Official Video",
        extractedMetadata: { ...extractedMetadata, trackName },
      }),
    ).toMatchObject({ state: "ready", id: 2 });
  });

  test("retains ambiguity and duration ranking", async () => {
    http.mockImplementation(async () =>
      Response.json([record, { ...record, id: 2, artistName: "Example Artist Two" }]),
    );
    expect(await fetchLyrics({ ...args, extractedMetadata })).toMatchObject({ state: "not_found" });
    http.mockImplementation(async () =>
      Response.json([
        { ...record, duration: 500 },
        { ...record, id: 2, duration: args.duration },
      ]),
    );
    expect(await fetchLyrics({ ...args, extractedMetadata })).toMatchObject({
      state: "ready",
      id: 2,
    });
  });

  test("does not start another candidate when its delay would exceed the deadline", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    http.mockImplementation(async () => {
      now.mockReturnValue(14_900);
      return Response.json([]);
    });
    await expect(fetchLyrics({ ...args, extractedMetadata })).rejects.toThrow("fallback deadline");
    expect(http).toHaveBeenCalledTimes(1);
  });

  test("bounds fallback request timeout and excessive rate-limit waits", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    http.mockImplementation(async () =>
      Response.json({}, { status: 429, headers: { "Retry-After": "3600" } }),
    );
    await expect(fetchLyrics({ ...args, extractedMetadata })).rejects.toThrow("fallback deadline");
    expect(timeout).toHaveBeenCalledWith(expect.any(Number));
    expect(timeout.mock.calls[0][0]).toBeLessThanOrEqual(15_000);
    expect(http).toHaveBeenCalledTimes(1);
  });
});

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

  test("does not reject duplicated slash-separated artist credits as ambiguous", () => {
    const match = rankLrclibMatches(
      [
        lrclibRecord(1, "Viva la Vida", "Coldplay/Coldplay", { duration: 242 }),
        lrclibRecord(2, "Viva La Vida", "Coldplay", { duration: 241 }),
      ],
      {
        candidates: [{ trackName: "Viva La Vida", artistName: "Coldplay" }],
        duration: 242,
      },
    );
    expect(match?.record.id).toBe(1);
  });

  test("preserves punctuation equivalence and genuinely distinct repeated-word artists", () => {
    expect(
      rankLrclibMatches(
        [lrclibRecord(1, "Example", "AC/DC"), lrclibRecord(2, "Example", "AC DC")],
        { candidates: [{ trackName: "Example", artistName: "AC/DC" }], duration: 131 },
      )?.record.id,
    ).toBe(1);
    expect(
      rankLrclibMatches(
        [lrclibRecord(1, "Example", "The The"), lrclibRecord(2, "Example", "The")],
        { candidates: [{ trackName: "Example" }], duration: 131 },
      ),
    ).toBeUndefined();
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
