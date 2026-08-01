import { describe, expect, test } from "bun:test";
import {
  reportFinalUpload,
  ytDlpDownloadCommand,
  ytDlpDownloadProgress,
} from "./process";

describe("reportFinalUpload", () => {
  test("holds completed media work at normalized 100% during final upload", async () => {
    const calls: unknown[][] = [];

    await reportFinalUpload(
      {
        progress: async (...args) => {
          calls.push(args);
        },
      },
      "Uploading final media",
    );

    expect(calls).toEqual([["uploading", 1, "Uploading final media", true]]);
  });
});

describe("ytDlpDownloadCommand", () => {
  test("explicitly enables progress suppressed by --print's quiet mode", () => {
    const command = ytDlpDownloadCommand("https://example.com/video", "/work/activity");

    expect(command).toContain("--print");
    expect(command).toContain("--progress");
    expect(command).toContain("--newline");
    expect(command).toContain("--progress-template");
    expect(command[command.indexOf("--progress-template") + 1]).toBe(
      "download:download:%(progress.downloaded_bytes)s|%(progress.total_bytes,progress.total_bytes_estimate)s",
    );
  });
});

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
