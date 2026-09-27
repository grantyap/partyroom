import { defineTable } from "convex/server";
import { v } from "convex/values";
import { annotationState, lyricTrackMetadata, lyricObservation } from "./validators";

const mediaOperationKind = v.union(
  v.literal("resolve"),
  v.literal("download"),
  v.literal("extractAudio"),
  v.literal("separate"),
  v.literal("transcribe"),
  v.literal("alignLyrics"),
  v.literal("analyzeMelody"),
  v.literal("assembleAnnotations"),
  v.literal("mux"),
);

// TODO(deprecation): Remove v1 activity projections in a future migration after
// production no longer contains rows written by the pre-cutover release.
const legacyActivityProjection = {
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
};

const mediaJobsFields = {
  // TODO(deprecation): Drop v1 workflowVersion values after all old journals expire.
  workflowVersion: v.optional(v.union(v.literal(1), v.literal(2))),
  requestKey: v.string(),
  encryptedSource: v.string(),
  sourceIv: v.string(),
  requestedBy: v.string(),
  rebuild: v.optional(v.boolean()),
  rebuildOf: v.optional(v.id("mediaJobs")),
  asset: v.optional(v.id("mediaAssets")),
  workflowId: v.optional(v.string()),
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

const mediaAssetsFields = {
  cacheKey: v.string(),
  extractor: v.string(),
  sourceId: v.string(),
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
};

const mediaLyricTracksFields = {
  asset: v.id("mediaAssets"),
  source: v.string(),
  label: v.string(),
  timing: v.union(v.literal("word"), v.literal("line")),
  textArtifactId: v.optional(v.string()),
  timedArtifactId: v.optional(v.string()),
  observations: v.optional(v.array(lyricObservation)),
  metadata: v.optional(lyricTrackMetadata),
  suggestedOffsetMs: v.optional(v.number()),
  error: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

const mediaEnrichmentsFields = {
  // TODO(deprecation): Drop v1 workflowVersion values with the same later migration.
  workflowVersion: v.optional(v.union(v.literal(1), v.literal(2))),
  asset: v.id("mediaAssets"),
  workflowId: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

// TODO(deprecation): Remove these four v1 row shapes in a later data migration
// after the rollback window closes and historical rows are normalized.
const legacyMediaJob = v.object({
  ...mediaJobsFields,
  ...legacyActivityProjection,
  state: v.union(
    v.literal("queued"),
    v.literal("processing"),
    v.literal("ready"),
    v.literal("failed"),
    v.literal("canceled"),
  ),
  stage: v.string(),
  progress: v.number(),
});

const legacyMediaAsset = v.object({
  ...mediaAssetsFields,
  state: v.union(v.literal("processing"), v.literal("ready"), v.literal("failed")),
});

const legacyLyricTrack = v.object({
  ...mediaLyricTracksFields,
  state: v.union(
    v.literal("processing"),
    v.literal("ready"),
    v.literal("not_found"),
    v.literal("failed"),
  ),
});

const legacyMediaEnrichment = v.object({
  ...mediaEnrichmentsFields,
  ...legacyActivityProjection,
  state: v.union(
    v.literal("processing"),
    v.literal("ready"),
    v.literal("failed"),
    v.literal("canceled"),
  ),
});

export const mediaTables = {
  mediaAssets: defineTable(
    v.union(
      v.object({
        ...mediaAssetsFields,
        state: v.literal("processing"),
        activeJob: v.id("mediaJobs"),
      }),
      legacyMediaAsset,
      v.object({
        ...mediaAssetsFields,
        state: v.literal("ready"),
        finalArtifactId: v.string(),
        activeJob: v.optional(v.null()),
      }),
      v.object({
        ...mediaAssetsFields,
        state: v.literal("failed"),
        activeJob: v.optional(v.null()),
      }),
    ),
  )
    .index("by_cache_key", ["cacheKey"])
    .index("by_cache_key_and_state", ["cacheKey", "state"])
    .index("by_active_job", ["activeJob"]),

  mediaLyricTracks: defineTable(
    v.union(
      v.object({ ...mediaLyricTracksFields, state: v.literal("processing") }),
      v.object({
        ...mediaLyricTracksFields,
        state: v.literal("ready"),
        observations: v.array(lyricObservation),
      }),
      v.object({
        ...mediaLyricTracksFields,
        state: v.literal("ready"),
        timedArtifactId: v.string(),
      }),
      v.object({ ...mediaLyricTracksFields, state: v.literal("not_found") }),
      v.object({ ...mediaLyricTracksFields, state: v.literal("failed"), error: v.string() }),
      legacyLyricTrack,
    ),
  )
    .index("by_asset", ["asset"])
    .index("by_asset_and_source", ["asset", "source"]),

  mediaJobs: defineTable(
    v.union(
      v.object({
        ...mediaJobsFields,
        state: v.literal("queued"),
        workflowId: v.optional(v.null()),
      }),
      v.object({ ...mediaJobsFields, state: v.literal("processing"), workflowId: v.string() }),
      v.object({
        ...mediaJobsFields,
        state: v.literal("ready"),
        asset: v.id("mediaAssets"),
        workflowId: v.string(),
      }),
      v.object({
        ...mediaJobsFields,
        state: v.literal("failed"),
        errorCode: v.string(),
        errorMessage: v.string(),
      }),
      v.object({ ...mediaJobsFields, state: v.literal("canceled"), errorMessage: v.string() }),
      legacyMediaJob,
    ),
  )
    .index("by_request_key", ["requestKey"])
    .index("by_request_key_and_state", ["requestKey", "state"])
    .index("by_state", ["state"])
    .index("by_requested_by", ["requestedBy"])
    .index("by_asset", ["asset"]),

  mediaEnrichments: defineTable(
    v.union(
      v.object({
        ...mediaEnrichmentsFields,
        state: v.literal("queued"),
        workflowId: v.optional(v.null()),
      }),
      legacyMediaEnrichment,
      v.object({
        ...mediaEnrichmentsFields,
        state: v.literal("processing"),
        workflowId: v.string(),
      }),
      v.object({ ...mediaEnrichmentsFields, state: v.literal("ready"), workflowId: v.string() }),
      v.object({
        ...mediaEnrichmentsFields,
        state: v.literal("failed"),
        workflowId: v.string(),
        error: v.string(),
      }),
      v.object({
        ...mediaEnrichmentsFields,
        state: v.literal("canceled"),
        workflowId: v.string(),
        error: v.string(),
      }),
    ),
  )
    .index("by_asset", ["asset"])
    .index("by_state", ["state"]),

  roomMedia: defineTable({
    room: v.id("rooms"),
    job: v.id("mediaJobs"),
    asset: v.optional(v.id("mediaAssets")),
    requestedBy: v.string(),
    createdAt: v.number(),
    selectedLyricsId: v.optional(v.string()),
    lyricsOffsetMs: v.optional(v.number()),
  })
    .index("by_room", ["room"])
    .index("by_job", ["job"])
    .index("by_asset", ["asset"])
    .index("by_room_job", ["room", "job"])
    .index("by_requested_by", ["requestedBy"]),
};
