import { describe, expect, test } from "vitest";
import {
  lrclibSearchTitle,
  parseSyncedLyrics,
  retryAfterMilliseconds,
  suggestLyricsOffsetMs,
} from "./lrclib";

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
});
