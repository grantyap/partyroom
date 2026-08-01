import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  mediaAssetState,
  annotationState,
  lyricTrackMetadata,
  lyricTrackState,
  lyricObservation,
  mediaEnrichmentState,
  mediaJobState,
  mediaOperationKind,
} from "./validators";

export const mediaTables = {
  mediaAssets: defineTable({
    cacheKey: v.string(),
    extractor: v.string(),
    sourceId: v.string(),
    state: mediaAssetState,
    activeJob: v.optional(v.id("mediaJobs")),
    title: v.optional(v.string()),
    duration: v.optional(v.number()),
    sourceArtifactId: v.optional(v.string()),
    extractedAudioArtifactId: v.optional(v.string()),
    instrumentalArtifactId: v.optional(v.string()),
    vocalsArtifactId: v.optional(v.string()),
    finalArtifactId: v.optional(v.string()),
    melodyArtifactId: v.optional(v.string()),
    annotationsArtifactId: v.optional(v.string()),
    midiArtifactId: v.optional(v.string()),
    musicXmlArtifactId: v.optional(v.string()),
    annotationsState: v.optional(annotationState),
    annotationsError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_cache_key", ["cacheKey"])
    .index("by_active_job", ["activeJob"]),

  mediaLyricTracks: defineTable({
    asset: v.id("mediaAssets"),
    source: v.string(),
    label: v.string(),
    timing: v.union(v.literal("word"), v.literal("line")),
    state: lyricTrackState,
    textArtifactId: v.optional(v.string()),
    timedArtifactId: v.optional(v.string()),
    observations: v.optional(v.array(lyricObservation)),
    metadata: v.optional(lyricTrackMetadata),
    suggestedOffsetMs: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_asset", ["asset"])
    .index("by_asset_and_source", ["asset", "source"]),

  mediaJobs: defineTable({
    requestKey: v.string(),
    encryptedSource: v.string(),
    sourceIv: v.string(),
    requestedBy: v.string(),
    state: mediaJobState,
    stage: v.string(),
    progress: v.number(),
    asset: v.optional(v.id("mediaAssets")),
    workflowId: v.optional(v.string()),
    activeActivities: v.optional(
      v.array(v.object({ activityId: v.string(), kind: mediaOperationKind })),
    ),
    stepTimings: v.optional(
      v.array(
        v.object({
          kind: mediaOperationKind,
          startedAt: v.number(),
          completedAt: v.number(),
        }),
      ),
    ),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_request_key", ["requestKey"])
    .index("by_asset", ["asset"]),

  mediaEnrichments: defineTable({
    asset: v.id("mediaAssets"),
    workflowId: v.optional(v.string()),
    state: mediaEnrichmentState,
    activeActivities: v.optional(
      v.array(v.object({ activityId: v.string(), kind: mediaOperationKind })),
    ),
    stepTimings: v.optional(
      v.array(
        v.object({
          kind: mediaOperationKind,
          startedAt: v.number(),
          completedAt: v.number(),
        }),
      ),
    ),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_asset", ["asset"]),

  roomMedia: defineTable({
    room: v.id("rooms"),
    job: v.id("mediaJobs"),
    asset: v.optional(v.id("mediaAssets")),
    requestedBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_room", ["room"])
    .index("by_job", ["job"])
    .index("by_asset", ["asset"])
    .index("by_room_job", ["room", "job"]),
};
