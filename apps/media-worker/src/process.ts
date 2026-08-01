import { basename, extname, join } from "node:path";
import { type ActivityContext, type ArtifactId } from "@partyroom/activity-worker";
import { assertSafeSourceUrl } from "./network";

const maxDuration = Number(process.env.MAX_MEDIA_DURATION_SECONDS ?? 1_200);
const maxBytes = Number(process.env.MAX_MEDIA_BYTES ?? 2_147_483_648);

type OperationRequest =
  | { kind: "resolve"; input: { sourceUrl: string } }
  | { kind: "download"; input: { sourceUrl: string } }
  | { kind: "extractAudio"; input: { sourceUrl: string } }
  | {
      kind: "mux";
      input: { videoUrl: string; instrumentalUrl: string };
    };

type WorkerResult = Record<string, string | number | boolean | null>;

export type MediaActivityReporter = {
  /**
   * Publishes the current overall progress for a media activity.
   *
   * @param stage - Descriptive identifier for the operation currently running.
   *   The activity adapter currently uses this for call-site context only.
   * @param progress - Overall activity completion normalized to the inclusive
   *   range `0..1`, where `1` means 100%. Pass `undefined` to send a heartbeat
   *   without changing the stored progress value.
   * @param message - Optional user-facing description of the current operation.
   * @param force - Compatibility hint requesting an immediate report. The
   *   current activity adapter already publishes every call immediately.
   */
  progress(
    stage: string,
    progress: number | undefined,
    message?: string,
    force?: boolean,
  ): Promise<void>;
  runProcess: ActivityContext["runProcess"];
  uploadArtifact: ActivityContext["uploadArtifact"];
};

type ProcessReporter = MediaActivityReporter;
type LineHandler = (line: string) => void | Promise<void>;

const ytDlpFormatsPrefix = "partyroom-formats:";
type YtDlpMetadata = {
  id?: string;
  extractor_key?: string;
  extractor?: string;
  title?: string;
  duration?: number;
};
type YtDlpSelectedFormat = {
  format_id?: unknown;
  filesize?: unknown;
  filesize_approx?: unknown;
};

async function resolveSource(sourceUrl: string, reporter: ProcessReporter) {
  await assertSafeSourceUrl(sourceUrl);
  let metadataJson = "";
  await run(
    ["yt-dlp", "--no-playlist", "--dump-single-json", "--skip-download", sourceUrl],
    (line) => {
      metadataJson += line;
    },
    reporter,
  );
  const metadata = JSON.parse(metadataJson) as YtDlpMetadata;
  if (!metadata.id || !(metadata.extractor_key || metadata.extractor)) {
    throw new Error("yt-dlp did not return a stable extractor identity");
  }
  if (metadata.duration && metadata.duration > maxDuration) {
    throw new Error("Media exceeds MAX_MEDIA_DURATION_SECONDS");
  }
  return metadata;
}

async function run(
  command: string[],
  onStdout?: LineHandler,
  reporter?: ProcessReporter,
  onStderr?: LineHandler,
) {
  return await reporter!.runProcess(command, {
    onStdoutLine: async (line) => {
      console.log(line);
      await onStdout?.(line);
    },
    onStderrLine: async (line) => {
      console.error(line);
      await onStderr?.(line);
    },
  });
}

export function ytDlpDownloadProgress(line: string) {
  const progress = parseYtDlpProgress(line);
  return progress && Math.min(1, progress.downloaded / progress.total);
}

function parseYtDlpProgress(line: string) {
  if (!line.startsWith("download:")) return undefined;
  const fields = line.slice("download:".length).split("|");
  const [formatId, downloadedText, totalText] =
    fields.length === 2 ? [undefined, ...fields] : fields;
  const downloaded = Number(downloadedText);
  const total = Number(totalText);
  if (!Number.isFinite(downloaded) || !Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  return { formatId, downloaded, total };
}

/**
 * Combines yt-dlp's per-format progress into one byte-weighted activity value.
 *
 * `ytDlpDownloadCommand` requests two machine-readable record types:
 *
 * - `partyroom-formats:<json>` is emitted once by `before_dl` on stdout. It
 *   describes every selected format and its exact or estimated byte size.
 * - `download:<format-id>|<downloaded-bytes>|<total-bytes>` is normally emitted
 *   on stderr for each progress update. Separate video, audio, and additional
 *   tracks each start their own byte counter at zero.
 *
 * `configure` stores the selected formats before downloading begins. `update`
 * records the current fraction for one format and returns the sum of every
 * format's completed bytes divided by their combined size. If selected sizes
 * are unavailable, formats receive equal weight. Returned progress is
 * monotonic so retries or corrected estimates cannot move the UI backward.
 */
export class YtDlpProgressAggregator {
  private configured = false;
  private selectedFormats: Array<{ id: string; size?: number }> = [];
  private progressByFormat = new Map<string, number>();
  private lastProgress = 0;

  /** Parses the one-time selected-format record written to stdout. */
  configure(line: string) {
    if (!line.startsWith(ytDlpFormatsPrefix)) return false;
    this.configured = true;
    try {
      const parsed = JSON.parse(line.slice(ytDlpFormatsPrefix.length)) as unknown;
      this.selectedFormats = Array.isArray(parsed)
        ? parsed.flatMap((format: YtDlpSelectedFormat) => {
            if (typeof format !== "object" || format === null) return [];
            const id = typeof format.format_id === "string" ? format.format_id : undefined;
            if (!id) return [];
            const candidate = Number(format.filesize ?? format.filesize_approx);
            const size = Number.isFinite(candidate) && candidate > 0 ? candidate : undefined;
            return [{ id, size }];
          })
        : [];
    } catch {
      this.selectedFormats = [];
    }
    return true;
  }

  /** Parses one per-format progress record and returns aggregate progress. */
  update(line: string) {
    if (!this.configured) return undefined;
    const progress = parseYtDlpProgress(line);
    if (!progress?.formatId) return undefined;
    const { formatId, downloaded, total } = progress;
    this.progressByFormat.set(formatId, Math.min(1, Math.max(0, downloaded / total)));

    const selected =
      this.selectedFormats.length > 0
        ? this.selectedFormats
        : [{ id: formatId, size: total }];
    if (!selected.some((format) => format.id === formatId)) {
      this.lastProgress = Math.max(
        this.lastProgress,
        Math.min(1, Math.max(0, downloaded / total)),
      );
      return this.lastProgress;
    }
    const allSizesKnown = selected.every((format) => format.size !== undefined);
    const weightedProgress = allSizesKnown
      ? selected.reduce(
          (sum, format) =>
            sum + (format.size ?? 0) * (this.progressByFormat.get(format.id) ?? 0),
          0,
        ) / selected.reduce((sum, format) => sum + (format.size ?? 0), 0)
      : selected.reduce(
          (sum, format) => sum + (this.progressByFormat.get(format.id) ?? 0),
          0,
        ) / selected.length;
    this.lastProgress = Math.max(this.lastProgress, Math.min(1, weightedProgress));
    return this.lastProgress;
  }
}

export function ytDlpDownloadCommand(sourceUrl: string, dir: string) {
  return [
    "yt-dlp",
    "--no-playlist",
    "--newline",
    "--progress",
    "--max-filesize",
    String(maxBytes),
    "--progress-template",
    "download:download:%(info.format_id)s|%(progress.downloaded_bytes)s|%(progress.total_bytes,progress.total_bytes_estimate)s",
    "--output",
    join(dir, "source.%(ext)s"),
    "--print",
    "before_dl:partyroom-formats:%(requested_formats.:.{format_id,filesize,filesize_approx}|[])j",
    "--print",
    "after_move:filepath",
    sourceUrl,
  ];
}

export async function reportFinalUpload(
  reporter: Pick<MediaActivityReporter, "progress">,
  message: string,
) {
  await reporter.progress("uploading", 1, message, true);
}

async function downloadFile(url: string, path: string) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download input: HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error("Input exceeds MAX_MEDIA_BYTES");
  const reader = response.body.getReader();
  const writer = Bun.file(path).writer();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw new Error("Input exceeds MAX_MEDIA_BYTES");
      writer.write(value);
    }
  } finally {
    await writer.end();
  }
}

function contentTypeFor(path: string) {
  switch (extname(path).toLowerCase()) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mkv":
      return "video/x-matroska";
    case ".flac":
      return "audio/flac";
    case ".wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

async function uploadOutput(reporter: ProcessReporter, slot: string, path: string) {
  if (Bun.file(path).size > maxBytes) throw new Error("Output exceeds MAX_MEDIA_BYTES");
  return await reporter.uploadArtifact(slot, Bun.file(path), contentTypeFor(path));
}

async function probeDuration(path: string, reporter: ProcessReporter) {
  let output = "";
  await run(
    [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      path,
    ],
    (line) => {
      output += line;
    },
    reporter,
  );
  const duration = Number(output);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("Unable to determine media duration");
  if (duration > maxDuration) throw new Error("Media exceeds MAX_MEDIA_DURATION_SECONDS");
  return duration;
}

async function runFfmpeg(
  command: string[],
  duration: number,
  reporter: ProcessReporter,
  stage: string,
) {
  let block: Record<string, string> = {};
  await run(
    command,
    async (line) => {
      const separator = line.indexOf("=");
      if (separator < 0) return;
      block[line.slice(0, separator)] = line.slice(separator + 1);
      if (line.startsWith("progress=")) {
        const outTimeUs = Number(block.out_time_us ?? 0);
        await reporter.progress(stage, outTimeUs / 1_000_000 / duration);
        block = {};
      }
    },
    reporter,
  );
}

async function processDownload(
  request: Extract<OperationRequest, { kind: "download" }>,
  reporter: ProcessReporter,
  dir: string,
) {
  await assertSafeSourceUrl(request.input.sourceUrl);
  let outputPath = "";
  const downloadProgress = new YtDlpProgressAggregator();
  await reporter.progress("downloading", 0, "Downloading source", true);
  const reportDownloadProgress = async (line: string) => {
    if (!line.startsWith("download:")) return;
    await reporter.progress("downloading", downloadProgress.update(line));
  };
  await run(
    ytDlpDownloadCommand(request.input.sourceUrl, dir),
    async (line) => {
      // yt-dlp writes the before_dl format inventory and final filepath to
      // stdout. Progress can also appear here with some downloader/configs.
      if (downloadProgress.configure(line)) {
        return;
      } else if (line.startsWith("download:")) {
        await reportDownloadProgress(line);
      } else if (line.trim()) {
        outputPath = line.trim();
      }
    },
    reporter,
    // yt-dlp normally writes progress-template records to stderr.
    reportDownloadProgress,
  );
  if (!outputPath || !outputPath.startsWith(dir) || !(await Bun.file(outputPath).exists())) {
    throw new Error("yt-dlp did not produce the expected output file");
  }

  await reportFinalUpload(reporter, "Uploading source");
  const artifactId = await uploadOutput(reporter, "artifactId", outputPath);
  return {
    artifactId,
    duration: await probeDuration(outputPath, reporter),
    fileName: basename(outputPath),
    contentType: contentTypeFor(outputPath),
  } satisfies WorkerResult;
}

async function processResolve(
  request: Extract<OperationRequest, { kind: "resolve" }>,
  reporter: ProcessReporter,
) {
  await reporter.progress("resolving", 0, "Resolving media source", true);
  const metadata = await resolveSource(request.input.sourceUrl, reporter);
  return {
    extractor: metadata.extractor_key ?? metadata.extractor ?? "unknown",
    sourceId: metadata.id!,
    title: metadata.title ?? "Untitled media",
    duration: metadata.duration ?? 0,
  } satisfies WorkerResult;
}

async function processExtractAudio(
  request: Extract<OperationRequest, { kind: "extractAudio" }>,
  reporter: ProcessReporter,
  dir: string,
) {
  const input = join(dir, "source");
  const output = join(dir, "audio.wav");
  await reporter.progress("extracting", 0, "Downloading source audio", true);
  await downloadFile(request.input.sourceUrl, input);
  const duration = await probeDuration(input, reporter);
  await runFfmpeg(
    [
      "ffmpeg",
      "-nostdin",
      "-nostats",
      "-y",
      "-i",
      input,
      "-vn",
      "-map",
      "0:a:0",
      "-c:a",
      "pcm_s16le",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-stats_period",
      "1",
      "-progress",
      "pipe:1",
      output,
    ],
    duration,
    reporter,
    "extracting",
  );
  await reportFinalUpload(reporter, "Uploading extracted audio");
  return {
    artifactId: await uploadOutput(reporter, "artifactId", output),
    duration,
    contentType: "audio/wav",
  };
}

async function processMux(
  request: Extract<OperationRequest, { kind: "mux" }>,
  reporter: ProcessReporter,
  dir: string,
) {
  const video = join(dir, "video");
  const instrumental = join(dir, "instrumental");
  const output = join(dir, "karaoke.mp4");
  await reporter.progress("muxing", 0, "Downloading media streams", true);
  await Promise.all([
    downloadFile(request.input.videoUrl, video),
    downloadFile(request.input.instrumentalUrl, instrumental),
  ]);
  const duration = await probeDuration(video, reporter);
  await runFfmpeg(
    [
      "ffmpeg",
      "-nostdin",
      "-nostats",
      "-y",
      "-i",
      video,
      "-i",
      instrumental,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "256k",
      "-shortest",
      "-movflags",
      "+faststart",
      "-stats_period",
      "1",
      "-progress",
      "pipe:1",
      output,
    ],
    duration,
    reporter,
    "muxing",
  );
  await reportFinalUpload(reporter, "Uploading final media");
  return {
    artifactId: await uploadOutput(reporter, "artifactId", output),
    duration,
    contentType: "video/mp4",
  };
}

async function sourceUrl(jobId: string) {
  const apiUrl = process.env.ACTIVITY_WORKER_API_URL;
  const token = process.env.ACTIVITY_WORKER_TOKEN;
  if (!apiUrl || !token) throw new Error("Activity worker API is not configured");
  const response = await fetch(new URL("media-source", apiUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jobId }),
  });
  if (!response.ok) throw new Error(`Media source request failed with HTTP ${response.status}`);
  const body = (await response.json()) as { sourceUrl?: string };
  if (!body.sourceUrl) throw new Error("Media source response did not include sourceUrl");
  return body.sourceUrl;
}

export async function resolveActivity(jobId: string, reporter: MediaActivityReporter) {
  return await processResolve(
    {
      kind: "resolve",
      input: { sourceUrl: await sourceUrl(jobId) },
    } as Extract<OperationRequest, { kind: "resolve" }>,
    reporter,
  );
}

export async function downloadActivity(
  jobId: string,
  reporter: MediaActivityReporter,
  directory: string,
) {
  const result = await processDownload(
    {
      kind: "download",
      input: { sourceUrl: await sourceUrl(jobId) },
    } as Extract<OperationRequest, { kind: "download" }>,
    reporter,
    directory,
  );
  return { ...result, artifactId: result.artifactId as ArtifactId };
}

export async function extractAudioActivity(
  sourceUrl: string,
  reporter: MediaActivityReporter,
  directory: string,
) {
  const result = await processExtractAudio(
    { kind: "extractAudio", input: { sourceUrl } } as Extract<
      OperationRequest,
      { kind: "extractAudio" }
    >,
    reporter,
    directory,
  );
  return { ...result, artifactId: result.artifactId as ArtifactId };
}

export async function muxActivity(
  videoUrl: string,
  instrumentalUrl: string,
  reporter: MediaActivityReporter,
  directory: string,
) {
  const result = await processMux(
    { kind: "mux", input: { videoUrl, instrumentalUrl } } as Extract<
      OperationRequest,
      { kind: "mux" }
    >,
    reporter,
    directory,
  );
  return { ...result, artifactId: result.artifactId as ArtifactId };
}
