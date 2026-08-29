import { v } from "convex/values";

const queueItemBase = {
  key: v.string(),
  roomMedia: v.id("roomMedia"),
  addedBy: v.string(),
  createdAt: v.number(),
};

export const processingQueueItem = v.object({
  ...queueItemBase,
  kind: v.literal("processing"),
});

export const failedQueueItem = v.object({
  ...queueItemBase,
  kind: v.literal("failed"),
  message: v.string(),
});

export const readyQueueItem = v.object({
  ...queueItemBase,
  kind: v.literal("ready"),
  asset: v.id("mediaAssets"),
  title: v.string(),
  durationSeconds: v.union(v.number(), v.null()),
  finalArtifactId: v.string(),
});

export const nonReadyQueueItem = v.union(processingQueueItem, failedQueueItem);
export const queueItem = v.union(processingQueueItem, readyQueueItem, failedQueueItem);

const currentTransport = {
  current: readyQueueItem,
  anchorPositionMs: v.number(),
  anchorUpdatedAt: v.number(),
};

const emptyTransport = v.union(
  v.object({ kind: v.literal("idle") }),
  v.object({ kind: v.literal("playing"), ...currentTransport }),
  v.object({
    kind: v.literal("paused"),
    ...currentTransport,
    reason: v.union(v.literal("user"), v.literal("room_empty")),
  }),
);

export const roomPlaybackState = v.union(
  v.object({
    kind: v.literal("empty"),
    emptySince: v.number(),
    occupancyGeneration: v.number(),
    transport: emptyTransport,
    queue: v.array(queueItem),
  }),
  v.object({
    kind: v.literal("occupiedWaiting"),
    occupancyGeneration: v.number(),
    presenceCheckAt: v.number(),
    queue: v.array(nonReadyQueueItem),
  }),
  v.object({
    kind: v.literal("occupiedPlaying"),
    occupancyGeneration: v.number(),
    presenceCheckAt: v.number(),
    ...currentTransport,
    queue: v.array(queueItem),
  }),
  v.object({
    kind: v.literal("occupiedPaused"),
    occupancyGeneration: v.number(),
    presenceCheckAt: v.number(),
    ...currentTransport,
    reason: v.union(v.literal("user"), v.literal("room_empty")),
    queue: v.array(queueItem),
  }),
);
