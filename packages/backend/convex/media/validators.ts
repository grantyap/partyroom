import { v } from "convex/values";

export const mediaJobState = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const mediaAssetState = v.union(
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
);

export const annotationState = v.union(
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
);

export const mediaEnrichmentState = v.union(
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const lyricTrackState = v.union(
  v.literal("processing"),
  v.literal("ready"),
  v.literal("not_found"),
  v.literal("failed"),
);

export const lyricObservation = v.object({
  time: v.number(),
  duration: v.number(),
  value: v.string(),
});

export const lyricTrackMetadata = v.object({
  providerId: v.optional(v.string()),
  trackName: v.optional(v.string()),
  artistName: v.optional(v.string()),
  albumName: v.optional(v.string()),
  format: v.optional(v.string()),
});

export const mediaOperationKind = v.union(
  v.literal("resolve"),
  v.literal("download"),
  v.literal("extractAudio"),
  v.literal("separate"),
  v.literal("transcribe"),
  v.literal("analyzeMelody"),
  v.literal("assembleAnnotations"),
  v.literal("mux"),
);

export type OperationKind =
  | "resolve"
  | "download"
  | "extractAudio"
  | "separate"
  | "transcribe"
  | "analyzeMelody"
  | "assembleAnnotations"
  | "mux";
