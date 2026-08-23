import { describe, expect, test } from "bun:test";
import {
  ffmpegProgress,
  parseYtDlpMetadata,
  muxFfmpegCommand,
  reportFinalUpload,
  ytDlpDownloadCommand,
  ytDlpDownloadProgress,
  YtDlpProgressAggregator,
} from "./process";

describe("ffmpegProgress", () => {
  test("ignores FFmpeg startup blocks without a numeric output time", () => {
    expect(ffmpegProgress("N/A", 120)).toBeUndefined();
    expect(ffmpegProgress(undefined, 120)).toBeUndefined();
    expect(ffmpegProgress("0", 0)).toBeUndefined();
  });

  test("normalizes and clamps numeric FFmpeg output times", () => {
    expect(ffmpegProgress("60000000", 120)).toBe(0.5);
    expect(ffmpegProgress("-1000", 120)).toBe(0);
    expect(ffmpegProgress("180000000", 120)).toBe(1);
  });
});

describe("muxFfmpegCommand", () => {
  test("produces a broadly supported H.264/AAC MP4", () => {
    const command = muxFfmpegCommand("video", "instrumental", "karaoke.mp4");

    expect(command.slice(command.indexOf("-threads"), command.indexOf("-i"))).toEqual([
      "-threads",
      "1",
    ]);
    expect(command.slice(command.indexOf("-c:v"), command.indexOf("-c:a"))).toEqual([
      "-c:v",
      "libx264",
      "-threads:v",
      "1",
      "-filter_threads",
      "1",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-vf",
      "scale=w=min(1920\\,iw):h=min(1080\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
    ]);
    expect(command).toContain("aac");
    expect(command).toContain("+faststart");
  });
});

describe("parseYtDlpMetadata", () => {
  test("parses the validated fields used by the media pipeline", () => {
    expect(
      parseYtDlpMetadata(
        JSON.stringify({
          id: "source-id",
          extractor_key: "Youtube",
          title: "Example",
          duration: 120,
          track: "Example Track",
          artist: "Example Artist",
          album: "Example Album",
          ignored: true,
        }),
      ),
    ).toMatchObject({
      id: "source-id",
      extractor_key: "Youtube",
      title: "Example",
      duration: 120,
      track: "Example Track",
      artist: "Example Artist",
      album: "Example Album",
    });
  });

  test("accepts an artists list when a singular artist is unavailable", () => {
    expect(
      parseYtDlpMetadata(
        JSON.stringify({
          id: "source-id",
          extractor: "generic",
          artists: ["First Artist", "Second Artist"],
        }),
      ),
    ).toMatchObject({ artists: ["First Artist", "Second Artist"] });
  });

  test("rejects malformed or incomplete metadata", () => {
    expect(() => parseYtDlpMetadata("{")).toThrow();
    expect(() => parseYtDlpMetadata('{"id":"source-id"}')).toThrow();
    expect(() =>
      parseYtDlpMetadata('{"id":"source-id","extractor":"generic","duration":"120"}'),
    ).toThrow();
  });
});

describe("YtDlpProgressAggregator", () => {
  test("weights sequential video and audio formats by their byte sizes", () => {
    const progress = new YtDlpProgressAggregator();
    progress.configure(
      'partyroom-formats:[{"format_id":"video","filesize":980},{"format_id":"audio","filesize":20}]',
    );

    expect(progress.update("download:video|490|980")).toBeCloseTo(0.49);
    expect(progress.update("download:video|980|980")).toBeCloseTo(0.98);
    expect(progress.update("download:audio|10|20")).toBeCloseTo(0.99);
    expect(progress.update("download:audio|20|20")).toBe(1);
  });

  test("aggregates every selected track", () => {
    const progress = new YtDlpProgressAggregator();
    progress.configure(
      'partyroom-formats:[{"format_id":"video","filesize":90},{"format_id":"audio-en","filesize":5},{"format_id":"audio-es","filesize":5}]',
    );

    expect(progress.update("download:video|90|90")).toBeCloseTo(0.9);
    expect(progress.update("download:audio-en|5|5")).toBeCloseTo(0.95);
    expect(progress.update("download:audio-es|5|5")).toBe(1);
  });

  test("weights formats equally when selected byte sizes are unavailable", () => {
    const progress = new YtDlpProgressAggregator();
    progress.configure(
      'partyroom-formats:[{"format_id":"video"},{"format_id":"audio"}]',
    );

    expect(progress.update("download:video|100|100")).toBeCloseTo(0.5);
    expect(progress.update("download:audio|50|100")).toBeCloseTo(0.75);
    expect(progress.update("download:audio|100|100")).toBe(1);
  });

  test("waits for selected-format metadata before reporting", () => {
    const progress = new YtDlpProgressAggregator();

    expect(progress.update("download:video|100|100")).toBeUndefined();
  });

  test("uses direct progress when yt-dlp downloads selected formats as one stream", () => {
    const progress = new YtDlpProgressAggregator();
    progress.configure(
      'partyroom-formats:[{"format_id":"video","filesize":90},{"format_id":"audio","filesize":10}]',
    );

    expect(progress.update("download:video+audio|50|100")).toBeCloseTo(0.5);
    expect(progress.update("download:video+audio|100|100")).toBe(1);
  });
});

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
      "download:download:%(info.format_id)s|%(progress.downloaded_bytes)s|%(progress.total_bytes,progress.total_bytes_estimate)s",
    );
    expect(command).toContain(
      "before_dl:partyroom-formats:%(requested_formats.:.{format_id,filesize,filesize_approx}|[])j",
    );
  });
});

describe("ytDlpDownloadProgress", () => {
  test("parses yt-dlp byte progress", () => {
    expect(ytDlpDownloadProgress("download:250|1000")).toBe(0.25);
    expect(ytDlpDownloadProgress("download:video|250|1000")).toBe(0.25);
    expect(ytDlpDownloadProgress("download:1000|1000")).toBe(1);
  });

  test("ignores unrelated or unavailable progress", () => {
    expect(ytDlpDownloadProgress("[download] Destination: source.webm")).toBeUndefined();
    expect(ytDlpDownloadProgress("download:250|NA")).toBeUndefined();
    expect(ytDlpDownloadProgress("download:NA|1000")).toBeUndefined();
    expect(ytDlpDownloadProgress("download:video||1000")).toBeUndefined();
    expect(ytDlpDownloadProgress("download:250|0")).toBeUndefined();
  });

  test("clamps estimates to the activity progress range", () => {
    expect(ytDlpDownloadProgress("download:1250|1000")).toBe(1);
  });
});
