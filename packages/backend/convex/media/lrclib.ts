import { v } from "convex/values";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { internalAction } from "../_generated/server";
import { lyricObservation } from "./validators";

const LRCLIB_ORIGIN = "https://lrclib.net";
const USER_AGENT = "Partyroom/1.0 (https://github.com/grantyap/partyroom)";
const MAX_RATE_LIMIT_ATTEMPTS = 3;
const PRODUCTION_LABEL = String.raw`(?:official\s+)?(?:music\s+video|video|audio|lyric(?:s)?\s+video|visuali[sz]er)`;
const BRACKETED_PRODUCTION_LABEL = new RegExp(
  String.raw`\s*[\[(]\s*${PRODUCTION_LABEL}\s*[\])]\s*`,
  "gi",
);
const DELIMITED_PRODUCTION_LABEL = new RegExp(
  String.raw`\s*(?:[-–—|•:]\s*)${PRODUCTION_LABEL}\s*$`,
  "i",
);

type LrclibRecord = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  syncedLyrics: string | null;
  lyricsfile?: string | null;
};

type LogFields = Record<string, boolean | number | string | null | undefined>;

export type NormalizedLyrics = {
  state: "ready" | "not_found";
  timing: "word" | "line";
  observations: Array<{ time: number; duration: number; value: string }>;
  format?: "lyricsfile" | "syncedLyrics";
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
};

type TimedText = { time: number; value: string };

const lyricsfileSchema = z.object({
  version: z.literal("1.0"),
  metadata: z.looseObject({
    offset_ms: z.number().optional(),
  }),
  lines: z
    .array(
      z.looseObject({
        text: z.string(),
        start_ms: z.number().nonnegative(),
        end_ms: z.number().nonnegative().optional(),
        words: z
          .array(
            z
              .object({
                text: z.string(),
                start_ms: z.number().nonnegative(),
                end_ms: z.number().nonnegative().optional(),
              })
              .passthrough(),
          )
          .optional(),
      }),
    )
    .optional(),
});

function isTimedText(value: unknown): value is TimedText {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { time?: unknown; value?: unknown };
  return (
    typeof candidate.time === "number" &&
    Number.isFinite(candidate.time) &&
    typeof candidate.value === "string"
  );
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function log(event: string, fields: LogFields) {
  console.info("[lrclib]", { event, ...fields });
}

export function retryAfterMilliseconds(value: string | null, now = Date.now()) {
  if (!value) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 1_000;
}

async function request(path: string, jobId: string) {
  for (let attempt = 1; attempt <= MAX_RATE_LIMIT_ATTEMPTS; attempt += 1) {
    const response = await fetch(`${LRCLIB_ORIGIN}${path}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status !== 429) return response;
    const retryAfterMs = retryAfterMilliseconds(response.headers.get("Retry-After"));
    log("search.rate_limited", {
      jobId,
      attempt,
      retryAfterMs,
    });
    if (attempt === MAX_RATE_LIMIT_ATTEMPTS) {
      throw new Error("LRCLIB rate limit persisted after 3 attempts");
    }
    await wait(retryAfterMs);
  }
  throw new Error("LRCLIB request exhausted its retry attempts");
}

function isRecord(value: unknown): value is LrclibRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LrclibRecord>;
  return (
    typeof record.id === "number" &&
    typeof record.trackName === "string" &&
    typeof record.artistName === "string" &&
    typeof record.albumName === "string" &&
    typeof record.duration === "number" &&
    typeof record.instrumental === "boolean" &&
    (typeof record.syncedLyrics === "string" || record.syncedLyrics === null) &&
    (record.lyricsfile === undefined ||
      typeof record.lyricsfile === "string" ||
      record.lyricsfile === null)
  );
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(value: string) {
  return normalize(value).split(" ").filter(Boolean);
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function suggestLyricsOffsetMs(
  referenceLyrics: TimedText[],
  generatedLyrics: TimedText[],
  timing: "word" | "line" = "line",
) {
  const generatedTokens = generatedLyrics.flatMap((observation) =>
    tokens(observation.value).map((token) => ({ token, time: observation.time })),
  );
  const referenceAnchors =
    timing === "word"
      ? referenceLyrics
          .flatMap((observation) =>
            tokens(observation.value).map((token) => ({ token, time: observation.time })),
          )
          .flatMap((word, index, words) => {
            const prefix = words.slice(index, index + 4);
            return prefix.length === 4
              ? [{ line: index, time: word.time, prefix: prefix.map(({ token }) => token) }]
              : [];
          })
      : referenceLyrics.flatMap((line, lineIndex) => {
          const prefix = tokens(line.value).slice(0, 4);
          return prefix.length >= 3 && Number.isFinite(line.time)
            ? [{ line: lineIndex, time: line.time, prefix }]
            : [];
        });
  const candidates: Array<{ line: number; offset: number }> = [];

  referenceAnchors.forEach((anchor) => {
    for (let index = 0; index <= generatedTokens.length - anchor.prefix.length; index += 1) {
      if (
        anchor.prefix.every(
          (token, tokenIndex) => generatedTokens[index + tokenIndex].token === token,
        )
      ) {
        candidates.push({
          line: anchor.line,
          offset: generatedTokens[index].time - anchor.time,
        });
      }
    }
  });

  let bestCluster: typeof candidates = [];
  let bestDistinctLines = 0;
  for (const candidate of candidates) {
    const cluster = candidates.filter(({ offset }) => Math.abs(offset - candidate.offset) <= 1.5);
    const distinctLines = new Set(cluster.map(({ line }) => line)).size;
    if (
      distinctLines > bestDistinctLines ||
      (distinctLines === bestDistinctLines && cluster.length > bestCluster.length)
    ) {
      bestCluster = cluster;
      bestDistinctLines = distinctLines;
    }
  }

  if (bestDistinctLines < 3) return null;
  const offsetSeconds = median(bestCluster.map(({ offset }) => offset));
  const medianDeviation = median(bestCluster.map(({ offset }) => Math.abs(offset - offsetSeconds)));
  if (medianDeviation > 0.75) return null;
  return Math.max(-30_000, Math.min(30_000, Math.round((offsetSeconds * 1_000) / 100) * 100));
}

export function lrclibSearchTitle(title: string) {
  return title
    .replace(BRACKETED_PRODUCTION_LABEL, " ")
    .replace(DELIMITED_PRODUCTION_LABEL, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bestMatch(
  records: LrclibRecord[],
  { title, duration }: { title: string; duration?: number },
) {
  const expectedTitle = normalize(title);
  return records
    .filter((record) => record.lyricsfile?.trim() || record.syncedLyrics?.trim())
    .map((record) => {
      const recordTitle = normalize(record.trackName);
      const recordSignature = normalize(`${record.artistName} ${record.trackName}`);
      const titleScore =
        recordTitle === expectedTitle || recordSignature === expectedTitle
          ? 100
          : recordTitle.includes(expectedTitle) ||
              expectedTitle.includes(recordTitle) ||
              recordSignature.includes(expectedTitle) ||
              expectedTitle.includes(recordSignature)
            ? 50
            : 0;
      const durationPenalty =
        duration === undefined ? 0 : Math.min(40, Math.abs(record.duration - duration) * 2);
      return {
        record,
        score: titleScore - durationPenalty,
        hasLyricsfile: !!record.lyricsfile?.trim(),
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || Number(right.hasLyricsfile) - Number(left.hasLyricsfile),
    )[0];
}

export function parseSyncedLyrics(
  syncedLyrics: string,
  trackDuration?: number,
): Array<{ time: number; duration: number; value: string }> {
  const lines = syncedLyrics
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]\s?(.*)$/.exec(line.trim());
      if (!match) return [];
      const fraction = (match[3] ?? "").padEnd(3, "0").slice(0, 3);
      const time = Number(match[1]) * 60 + Number(match[2]) + Number(fraction) / 1_000;
      const value = match[4].trim().slice(0, 300);
      return value && Number.isFinite(time) ? [{ time, value }] : [];
    })
    .sort((left, right) => left.time - right.time);

  return lines
    .flatMap((line, index) => {
      const nextTime = lines[index + 1]?.time;
      const end =
        nextTime ??
        (trackDuration !== undefined && trackDuration > line.time ? trackDuration : line.time + 4);
      const duration = Math.round((end - line.time) * 1_000) / 1_000;
      return duration > 0 ? [{ ...line, duration }] : [];
    })
    .slice(0, 1_000);
}

export function parseLyricsfile(lyricsfile: string): {
  timing: "word" | "line";
  observations: Array<{ time: number; duration: number; value: string }>;
} | null {
  if (!lyricsfile.trim() || lyricsfile.length > 1_000_000) return null;
  try {
    const document = lyricsfileSchema.parse(parseYaml(lyricsfile));
    const lines = document.lines ?? [];
    const offsetMs = document.metadata.offset_ms ?? 0;
    const words = lines
      .flatMap((line) =>
        (line.words ?? []).flatMap((word, index, lineWords) => {
          const startMs = word.start_ms + offsetMs;
          const endMs =
            (word.end_ms ?? lineWords[index + 1]?.start_ms ?? line.end_ms ?? word.start_ms + 500) +
            offsetMs;
          const value = word.text.trim().slice(0, 300);
          return value && startMs >= 0 && endMs > startMs
            ? [{ time: startMs / 1_000, duration: (endMs - startMs) / 1_000, value }]
            : [];
        }),
      )
      .sort((left, right) => left.time - right.time)
      .slice(0, 3_000);
    if (words.length > 0) return { timing: "word", observations: words };

    const lineObservations = lines
      .flatMap((line, index) => {
        const startMs = line.start_ms + offsetMs;
        const endMs =
          (line.end_ms ?? lines[index + 1]?.start_ms ?? line.start_ms + 4_000) + offsetMs;
        const value = line.text.trim().slice(0, 300);
        return value && startMs >= 0 && endMs > startMs
          ? [{ time: startMs / 1_000, duration: (endMs - startMs) / 1_000, value }]
          : [];
      })
      .sort((left, right) => left.time - right.time)
      .slice(0, 1_000);
    return lineObservations.length > 0 ? { timing: "line", observations: lineObservations } : null;
  } catch {
    return null;
  }
}

export function normalizeLrclibTimedLyrics({
  lyricsfile,
  syncedLyrics,
  duration,
}: {
  lyricsfile?: string | null;
  syncedLyrics: string | null;
  duration?: number;
}): {
  timing: "word" | "line";
  format: "lyricsfile" | "syncedLyrics";
  observations: Array<{ time: number; duration: number; value: string }>;
} | null {
  const parsedLyricsfile = lyricsfile ? parseLyricsfile(lyricsfile) : null;
  if (parsedLyricsfile) return { ...parsedLyricsfile, format: "lyricsfile" };
  const observations = syncedLyrics ? parseSyncedLyrics(syncedLyrics, duration) : [];
  return observations.length > 0 ? { timing: "line", format: "syncedLyrics", observations } : null;
}

async function fetchLyrics(args: {
  jobId: string;
  title: string;
  duration?: number;
}): Promise<NormalizedLyrics> {
  const query = lrclibSearchTitle(args.title) || args.title;
  const params = new URLSearchParams({ q: query });
  const path = `/api/search?${params}`;
  log("search.started", {
    jobId: args.jobId,
    originalTitle: args.title,
    query,
    duration: args.duration,
    url: `${LRCLIB_ORIGIN}${path}`,
  });
  const response = await request(path, args.jobId);
  if (!response.ok) throw new Error(`LRCLIB search failed with HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!Array.isArray(value)) throw new Error("LRCLIB search returned an invalid response");
  const records = value.filter(isRecord);
  const match = bestMatch(records, { title: query, duration: args.duration });
  log("search.completed", {
    jobId: args.jobId,
    resultCount: records.length,
    syncedResultCount: records.filter((record) => record.syncedLyrics?.trim()).length,
    lyricsfileResultCount: records.filter((record) => record.lyricsfile?.trim()).length,
  });

  if (!match) {
    log("search.not_found", {
      jobId: args.jobId,
      query,
      reason: "no_timed_results",
    });
    return { state: "not_found", timing: "line", observations: [] };
  }
  const { record, score } = match;
  const normalized = normalizeLrclibTimedLyrics(record);
  if (record.lyricsfile?.trim() && normalized?.format !== "lyricsfile") {
    log("lyricsfile.invalid", {
      jobId: args.jobId,
      providerId: record.id,
      lyricsfileCharacters: record.lyricsfile.length,
    });
  }
  if (!normalized) {
    log("search.not_found", {
      jobId: args.jobId,
      query,
      providerId: record.id,
      reason: "selected_timed_lyrics_could_not_be_parsed",
    });
    return { state: "not_found", timing: "line", observations: [] };
  }
  log("search.selected", {
    jobId: args.jobId,
    providerId: record.id,
    trackName: record.trackName,
    artistName: record.artistName,
    albumName: record.albumName,
    duration: record.duration,
    score,
    timing: normalized.timing,
    format: normalized.format,
    observationCount: normalized.observations.length,
    lyricsCharacters:
      normalized.format === "lyricsfile" ? record.lyricsfile?.length : record.syncedLyrics?.length,
  });
  return {
    state: "ready",
    timing: normalized.timing,
    observations: normalized.observations,
    format: normalized.format,
    id: record.id,
    trackName: record.trackName,
    artistName: record.artistName,
    albumName: record.albumName,
  };
}

export const lookup = internalAction({
  args: {
    jobId: v.id("mediaJobs"),
    title: v.string(),
    duration: v.optional(v.number()),
  },
  returns: v.object({
    state: v.union(v.literal("ready"), v.literal("not_found")),
    timing: v.union(v.literal("word"), v.literal("line")),
    observations: v.array(lyricObservation),
    format: v.optional(v.union(v.literal("lyricsfile"), v.literal("syncedLyrics"))),
    id: v.optional(v.number()),
    trackName: v.optional(v.string()),
    artistName: v.optional(v.string()),
    albumName: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    try {
      return await fetchLyrics(args);
    } catch (error) {
      log("search.failed", {
        jobId: args.jobId,
        originalTitle: args.title,
        query: lrclibSearchTitle(args.title) || args.title,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

export const suggestOffset = internalAction({
  args: {
    requestId: v.string(),
    generatedLyricsUrl: v.string(),
    referenceObservations: v.array(lyricObservation),
    referenceTiming: v.union(v.literal("word"), v.literal("line")),
  },
  returns: v.union(v.number(), v.null()),
  handler: async (_ctx, args) => {
    const response = await fetch(args.generatedLyricsUrl, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`Generated lyrics fetch failed with HTTP ${response.status}`);
    }
    const document: unknown = await response.json();
    const observations =
      document &&
      typeof document === "object" &&
      "observations" in document &&
      Array.isArray(document.observations)
        ? document.observations.filter(isTimedText)
        : [];
    const suggestedOffsetMs = suggestLyricsOffsetMs(
      args.referenceObservations,
      observations,
      args.referenceTiming,
    );
    log(suggestedOffsetMs === null ? "offset.unavailable" : "offset.suggested", {
      requestId: args.requestId,
      suggestedOffsetMs,
      referenceLineCount: args.referenceObservations.length,
      generatedObservationCount: observations.length,
    });
    return suggestedOffsetMs;
  },
});
