import { describe, expect, test } from "bun:test";
import { ytDlpDownloadProgress } from "./process";

describe("ytDlpDownloadProgress", () => {
  test("parses yt-dlp byte progress", () => {
    expect(ytDlpDownloadProgress("download:250|1000")).toBe(0.25);
    expect(ytDlpDownloadProgress("download:1000|1000")).toBe(1);
  });

  test("ignores unrelated or unavailable progress", () => {
    expect(ytDlpDownloadProgress("[download] Destination: source.webm")).toBeUndefined();
    expect(ytDlpDownloadProgress("download:250|NA")).toBeUndefined();
    expect(ytDlpDownloadProgress("download:NA|1000")).toBeUndefined();
    expect(ytDlpDownloadProgress("download:250|0")).toBeUndefined();
  });

  test("clamps estimates to the activity progress range", () => {
    expect(ytDlpDownloadProgress("download:1250|1000")).toBe(1);
  });
});
