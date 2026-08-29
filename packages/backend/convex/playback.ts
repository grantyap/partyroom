import { type ArtifactId } from "@partyroom/activities";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { activities } from "./activities/workflowManager";
import { removeRoomMedia } from "./media/domain/jobs";
import { presence } from "./presenceComponent";
import { requireRoomAction, userHasRoomPermission, type RoomPermission } from "./rooms";

const PRESENCE_CHECK_INTERVAL_MS = 30_000;
const EMPTY_PAUSE_GRACE_MS = 15_000;
const EMPTY_ROOM_LIFETIME_MS = 10 * 60_000;
const MAX_QUEUE_ITEMS = 200;
const DEFAULT_PLAY_START_DELAY_MS = 1_000;

const queueItemResultBase = {
  _id: v.string(),
  roomMedia: v.id("roomMedia"),
  addedBy: v.string(),
  createdAt: v.number(),
};
const processingQueueItemResult = v.object({
  ...queueItemResultBase,
  kind: v.literal("processing"),
  availability: v.literal("processing"),
  finalUrl: v.null(),
});
const failedQueueItemResult = v.object({
  ...queueItemResultBase,
  kind: v.literal("failed"),
  availability: v.literal("failed"),
  message: v.string(),
  finalUrl: v.null(),
});
const readyQueueItemResult = v.object({
  ...queueItemResultBase,
  kind: v.literal("ready"),
  availability: v.literal("ready"),
  asset: v.id("mediaAssets"),
  title: v.string(),
  durationSeconds: v.union(v.number(), v.null()),
  finalUrl: v.union(v.string(), v.null()),
});
const playbackResult = v.object({
  playback: v.object({
    vector: v.object({
      position: v.number(),
      velocity: v.number(),
      acceleration: v.number(),
      timestamp: v.number(),
    }),
    revision: v.number(),
    queueRevision: v.number(),
    stateKind: v.union(
      v.literal("empty"),
      v.literal("occupiedWaiting"),
      v.literal("occupiedPlaying"),
      v.literal("occupiedPaused"),
    ),
  }),
  current: v.union(readyQueueItemResult, v.null()),
  queue: v.array(
    v.union(processingQueueItemResult, failedQueueItemResult, readyQueueItemResult),
  ),
  permissions: v.object({
    controlPlayback: v.boolean(),
    addToQueue: v.boolean(),
    reorderQueue: v.boolean(),
    removeFromQueue: v.boolean(),
    sendChat: v.boolean(),
    updateRoom: v.boolean(),
  }),
});

type PlaybackState = Doc<"roomPlayback">["state"];
type QueueItem = Extract<
  PlaybackState,
  { kind: "empty" | "occupiedPlaying" | "occupiedPaused" }
>["queue"][number];
type ReadyItem = Extract<QueueItem, { kind: "ready" }>;
type NonReadyItem = Exclude<QueueItem, ReadyItem>;
type TimingUpdate = { position?: number; velocity?: number; acceleration?: number };
export type TimingStateVectorUpdate = TimingUpdate;

async function playbackForRoom(ctx: QueryCtx | MutationCtx, roomId: Id<"rooms">) {
  const playback = await ctx.db
    .query("roomPlayback")
    .withIndex("by_room", (q) => q.eq("room", roomId))
    .unique();
  if (!playback) throw new Error("Room playback state not found");
  return playback;
}

function currentItem(state: PlaybackState): ReadyItem | null {
  if (state.kind === "occupiedPlaying" || state.kind === "occupiedPaused") return state.current;
  if (state.kind === "empty" && state.transport.kind !== "idle") return state.transport.current;
  return null;
}

function queueItems(state: PlaybackState): QueueItem[] {
  return state.queue;
}

function activeTiming(state: PlaybackState) {
  if (state.kind === "occupiedPlaying" || state.kind === "occupiedPaused") return state;
  if (state.kind === "empty" && state.transport.kind !== "idle") return state.transport;
  return null;
}

function isPlaying(state: PlaybackState) {
  return (
    state.kind === "occupiedPlaying" ||
    (state.kind === "empty" && state.transport.kind === "playing")
  );
}

function projectedPositionMs(state: PlaybackState, now: number) {
  const timing = activeTiming(state);
  if (!timing) return 0;
  if (!isPlaying(state)) return timing.anchorPositionMs;
  return Math.max(0, timing.anchorPositionMs + Math.max(0, now - timing.anchorUpdatedAt));
}

async function readyItemForRoomMedia(
  ctx: QueryCtx | MutationCtx,
  roomMediaId: Id<"roomMedia">,
  base: Pick<QueueItem, "key" | "roomMedia" | "addedBy" | "createdAt">,
): Promise<ReadyItem | null> {
  const roomMedia = await ctx.db.get("roomMedia", roomMediaId);
  if (!roomMedia) return null;
  const job = await ctx.db.get("mediaJobs", roomMedia.job);
  if (job?.state !== "ready") return null;
  const assetId = roomMedia.asset ?? job.asset;
  const asset = assetId ? await ctx.db.get("mediaAssets", assetId) : null;
  if (!asset || asset.state !== "ready" || !asset.finalArtifactId) return null;
  return {
    ...base,
    kind: "ready",
    asset: asset._id,
    title: asset.title?.trim() || "Untitled media",
    durationSeconds: asset.duration ?? null,
    finalArtifactId: asset.finalArtifactId,
  };
}

async function initialQueueItem(
  ctx: MutationCtx,
  roomMedia: Doc<"roomMedia">,
  addedBy: string,
): Promise<QueueItem> {
  const base = {
    key: crypto.randomUUID(),
    roomMedia: roomMedia._id,
    addedBy,
    createdAt: Date.now(),
  };
  const ready = await readyItemForRoomMedia(ctx, roomMedia._id, base);
  if (ready) return ready;
  const job = await ctx.db.get("mediaJobs", roomMedia.job);
  return job?.state === "failed"
    ? { ...base, kind: "failed", message: job.errorMessage ?? "Media processing failed" }
    : { ...base, kind: "processing" };
}

function promoteReadyFromOccupiedQueue(
  state: Extract<PlaybackState, { kind: "occupiedWaiting" }>,
  queue: QueueItem[],
  now: number,
): PlaybackState {
  const index = queue.findIndex((item) => item.kind === "ready");
  if (index < 0) return { ...state, queue: queue as NonReadyItem[] };
  const current = queue[index] as ReadyItem;
  return {
    kind: "occupiedPlaying",
    occupancyGeneration: state.occupancyGeneration,
    presenceCheckAt: state.presenceCheckAt,
    current,
    anchorPositionMs: 0,
    anchorUpdatedAt: now,
    queue: [...queue.slice(0, index), ...queue.slice(index + 1)],
  };
}

function appendQueueItem(state: PlaybackState, item: QueueItem, now: number): PlaybackState {
  if (state.kind === "occupiedWaiting") {
    return promoteReadyFromOccupiedQueue(state, [...state.queue, item], now);
  }
  return { ...state, queue: [...state.queue, item] };
}

function replaceQueuedMedia(
  state: PlaybackState,
  roomMediaId: Id<"roomMedia">,
  replace: (item: QueueItem) => QueueItem,
  now: number,
): PlaybackState {
  const queue = state.queue.map((item) =>
    item.roomMedia === roomMediaId ? replace(item as QueueItem) : item,
  );
  if (state.kind === "occupiedWaiting") return promoteReadyFromOccupiedQueue(state, queue, now);
  return { ...state, queue } as PlaybackState;
}

async function scheduleAutomaticAdvance(
  ctx: MutationCtx,
  item: ReadyItem,
  roomId: Id<"rooms">,
  revision: number,
  positionMs: number,
  startDelayMs = 0,
) {
  if (item.durationSeconds === null) return;
  await ctx.scheduler.runAfter(
    startDelayMs + Math.max(0, item.durationSeconds * 1_000 - positionMs),
    internal.playback.finishIfCurrent,
    { roomId, currentKey: item.key, expectedRevision: revision },
  );
}

async function scheduleIfNewCurrent(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  previous: PlaybackState,
  next: PlaybackState,
  revision: number,
) {
  const before = currentItem(previous);
  const after = currentItem(next);
  if (after && after.key !== before?.key && isPlaying(next)) {
    await scheduleAutomaticAdvance(ctx, after, roomId, revision, 0);
  }
}

function userCan(room: Doc<"rooms">, userId: string, permission: RoomPermission) {
  return userHasRoomPermission({ user: userId, room, permission });
}

async function artifactUrl(ctx: QueryCtx, artifactId: string) {
  return await activities.getArtifactUrl(ctx, artifactId as ArtifactId);
}

async function readyQueueItemForClient(ctx: QueryCtx, item: ReadyItem) {
  return {
    _id: item.key,
    roomMedia: item.roomMedia,
    addedBy: item.addedBy,
    createdAt: item.createdAt,
    kind: item.kind,
    availability: item.kind,
    asset: item.asset,
    title: item.title,
    durationSeconds: item.durationSeconds,
    finalUrl: await artifactUrl(ctx, item.finalArtifactId),
  };
}

async function queueItemForClient(ctx: QueryCtx, item: QueueItem) {
  const base = {
    _id: item.key,
    roomMedia: item.roomMedia,
    addedBy: item.addedBy,
    createdAt: item.createdAt,
  };
  if (item.kind === "processing") {
    return { ...base, kind: item.kind, availability: item.kind, finalUrl: null };
  }
  if (item.kind === "failed") {
    return {
      ...base,
      kind: item.kind,
      availability: item.kind,
      message: item.message,
      finalUrl: null,
    };
  }
  return await readyQueueItemForClient(ctx, item);
}

export const get = query({
  args: { roomId: v.id("rooms") },
  returns: playbackResult,
  handler: async (ctx, { roomId }) => {
    const { room, user } = await requireRoomAction(ctx, roomId, "rooms:read");
    const playback = await playbackForRoom(ctx, roomId);
    const current = currentItem(playback.state);
    const timing = activeTiming(playback.state);
    const queue = await Promise.all(
      queueItems(playback.state).map((item) => queueItemForClient(ctx, item)),
    );
    return {
      playback: {
        vector: {
          position: (timing?.anchorPositionMs ?? 0) / 1_000,
          velocity: isPlaying(playback.state) ? 1 : 0,
          acceleration: 0,
          timestamp: (timing?.anchorUpdatedAt ?? Date.now()) / 1_000,
        },
        revision: playback.revision,
        queueRevision: playback.queueRevision,
        stateKind: playback.state.kind,
      },
      current: current ? await readyQueueItemForClient(ctx, current) : null,
      queue,
      permissions: {
        controlPlayback: userCan(room, user._id, "rooms:controlPlayback"),
        addToQueue: userCan(room, user._id, "rooms:addToQueue"),
        reorderQueue: userCan(room, user._id, "rooms:reorderQueue"),
        removeFromQueue: userCan(room, user._id, "rooms:removeFromQueue"),
        sendChat: userCan(room, user._id, "rooms:chat"),
        updateRoom: userCan(room, user._id, "rooms:update"),
      },
    };
  },
});

export const clock = action({
  args: {},
  returns: v.object({ timestamp: v.number() }),
  handler: async () => ({ timestamp: Date.now() / 1_000 }),
});

export async function enqueueRoomMedia(
  ctx: MutationCtx,
  args: { roomId: Id<"rooms">; roomMediaId: Id<"roomMedia">; addedBy: string },
) {
  const roomMedia = await ctx.db.get("roomMedia", args.roomMediaId);
  if (!roomMedia || roomMedia.room !== args.roomId) throw new Error("Room media item not found");
  const playback = await playbackForRoom(ctx, args.roomId);
  if (queueItems(playback.state).length >= MAX_QUEUE_ITEMS) throw new Error("The queue is full");
  const item = await initialQueueItem(ctx, roomMedia, args.addedBy);
  const state = appendQueueItem(playback.state, item, Date.now());
  const revision =
    playback.revision + (currentItem(state)?.key !== currentItem(playback.state)?.key ? 1 : 0);
  await ctx.db.patch("roomPlayback", playback._id, {
    state,
    revision,
    queueRevision: playback.queueRevision + 1,
  });
  await scheduleIfNewCurrent(ctx, args.roomId, playback.state, state, revision);
  return item.key;
}

export const add = mutation({
  args: { roomId: v.id("rooms"), roomMediaId: v.id("roomMedia") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { user } = await requireRoomAction(ctx, args.roomId, "rooms:addToQueue");
    return await enqueueRoomMedia(ctx, { ...args, addedBy: user._id });
  },
});

export async function updateRoomTiming(
  ctx: MutationCtx,
  {
    roomId,
    currentKey,
    update,
    playStartDelayMs = DEFAULT_PLAY_START_DELAY_MS,
  }: {
    roomId: Id<"rooms">;
    currentKey: string;
    update: TimingUpdate;
    playStartDelayMs?: number;
  },
  now = Date.now(),
) {
  if (
    update.position === undefined &&
    update.velocity === undefined &&
    update.acceleration === undefined
  )
    throw new Error("A timing update must change at least one vector component");
  if (update.position !== undefined && (!Number.isFinite(update.position) || update.position < 0))
    throw new Error("Timing position must be a finite non-negative number");
  if (update.velocity !== undefined && update.velocity !== 0 && update.velocity !== 1)
    throw new Error("Partyroom only supports timing velocity 0 or 1");
  if (update.acceleration !== undefined && update.acceleration !== 0)
    throw new Error("Partyroom only supports timing acceleration 0");
  if (!Number.isFinite(playStartDelayMs) || playStartDelayMs < 0)
    throw new Error("Playback start delay must be a finite non-negative number");

  const playback = await playbackForRoom(ctx, roomId);
  const current = currentItem(playback.state);
  const timing = activeTiming(playback.state);
  if (!current || !timing || current.key !== currentKey) return;
  const positionMs =
    update.position === undefined
      ? projectedPositionMs(playback.state, now)
      : update.position * 1_000;
  const velocity = update.velocity ?? (isPlaying(playback.state) ? 1 : 0);
  const startDelayMs = velocity === 1 ? playStartDelayMs : 0;
  const anchorUpdatedAt = now + startDelayMs;
  let state: PlaybackState;
  if (playback.state.kind === "empty") {
    state = {
      ...playback.state,
      transport:
        velocity === 1
          ? { kind: "playing", current, anchorPositionMs: positionMs, anchorUpdatedAt }
          : {
              kind: "paused",
              current,
              anchorPositionMs: positionMs,
              anchorUpdatedAt,
              reason: "user",
            },
    };
  } else {
    const common = {
      occupancyGeneration: playback.state.occupancyGeneration,
      presenceCheckAt: playback.state.presenceCheckAt,
      current,
      anchorPositionMs: positionMs,
      anchorUpdatedAt,
      queue: playback.state.queue,
    };
    state =
      velocity === 1
        ? { kind: "occupiedPlaying", ...common }
        : { kind: "occupiedPaused", ...common, reason: "user" };
  }
  const revision = playback.revision + 1;
  await ctx.db.patch("roomPlayback", playback._id, { state, revision });
  if (velocity === 1)
    await scheduleAutomaticAdvance(ctx, current, roomId, revision, positionMs, startDelayMs);
}

export const update = mutation({
  args: {
    roomId: v.id("rooms"),
    currentKey: v.string(),
    vector: v.object({
      position: v.optional(v.number()),
      velocity: v.optional(v.number()),
      acceleration: v.optional(v.number()),
    }),
    playStartDelaySeconds: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { roomId, currentKey, vector, playStartDelaySeconds }) => {
    await requireRoomAction(ctx, roomId, "rooms:controlPlayback");
    await updateRoomTiming(ctx, {
      roomId,
      currentKey,
      update: vector,
      playStartDelayMs:
        playStartDelaySeconds === undefined ? undefined : playStartDelaySeconds * 1_000,
    });
    return null;
  },
});

export async function advanceRoomPlayback(
  ctx: MutationCtx,
  args: { roomId: Id<"rooms">; currentKey: string; expectedRevision?: number },
) {
  const playback = await playbackForRoom(ctx, args.roomId);
  const current = currentItem(playback.state);
  if (
    (args.expectedRevision !== undefined && playback.revision !== args.expectedRevision) ||
    current?.key !== args.currentKey
  )
    return;
  const queue = queueItems(playback.state);
  let state: PlaybackState;
  if (playback.state.kind === "empty") {
    state = { ...playback.state, transport: { kind: "idle" } };
  } else {
    const nextIndex = queue.findIndex((item) => item.kind === "ready");
    if (nextIndex < 0) {
      state = {
        kind: "occupiedWaiting",
        occupancyGeneration: playback.state.occupancyGeneration,
        presenceCheckAt: playback.state.presenceCheckAt,
        queue: queue as NonReadyItem[],
      };
    } else {
      const next = queue[nextIndex] as ReadyItem;
      state = {
        kind: "occupiedPlaying",
        occupancyGeneration: playback.state.occupancyGeneration,
        presenceCheckAt: playback.state.presenceCheckAt,
        current: next,
        anchorPositionMs: 0,
        anchorUpdatedAt: Date.now(),
        queue: [...queue.slice(0, nextIndex), ...queue.slice(nextIndex + 1)],
      };
    }
  }
  const revision = playback.revision + 1;
  await ctx.db.patch("roomPlayback", playback._id, {
    state,
    revision,
    queueRevision: playback.queueRevision + 1,
  });
  const next = currentItem(state);
  if (next && isPlaying(state)) await scheduleAutomaticAdvance(ctx, next, args.roomId, revision, 0);
}

export const advance = mutation({
  args: { roomId: v.id("rooms"), currentKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRoomAction(ctx, args.roomId, "rooms:controlPlayback");
    await advanceRoomPlayback(ctx, args);
    return null;
  },
});

export const finishIfCurrent = internalMutation({
  args: { roomId: v.id("rooms"), currentKey: v.string(), expectedRevision: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const playback = await playbackForRoom(ctx, args.roomId);
    if (isPlaying(playback.state)) await advanceRoomPlayback(ctx, args);
    return null;
  },
});

export const remove = mutation({
  args: { roomId: v.id("rooms"), queueItemKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { roomId, queueItemKey }) => {
    await requireRoomAction(ctx, roomId, "rooms:removeFromQueue");
    const playback = await playbackForRoom(ctx, roomId);
    const queue = queueItems(playback.state);
    if (!queue.some((item) => item.key === queueItemKey)) throw new Error("Queue item not found");
    const state = {
      ...playback.state,
      queue: queue.filter((item) => item.key !== queueItemKey),
    } as PlaybackState;
    await ctx.db.patch("roomPlayback", playback._id, {
      state,
      queueRevision: playback.queueRevision + 1,
    });
    return null;
  },
});

export const reorder = mutation({
  args: {
    roomId: v.id("rooms"),
    queueItemKey: v.string(),
    afterItemKey: v.union(v.string(), v.null()),
    beforeItemKey: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { roomId, queueItemKey, afterItemKey, beforeItemKey }) => {
    await requireRoomAction(ctx, roomId, "rooms:reorderQueue");
    const playback = await playbackForRoom(ctx, roomId);
    const queue = queueItems(playback.state);
    const moving = queue.find((item) => item.key === queueItemKey);
    if (!moving) throw new Error("Queue item not found");
    const remaining = queue.filter((item) => item.key !== queueItemKey);
    const afterIndex =
      afterItemKey === null ? -1 : remaining.findIndex((item) => item.key === afterItemKey);
    const beforeIndex =
      beforeItemKey === null
        ? remaining.length
        : remaining.findIndex((item) => item.key === beforeItemKey);
    if (
      (afterItemKey !== null && afterIndex < 0) ||
      (beforeItemKey !== null && beforeIndex < 0) ||
      beforeIndex !== afterIndex + 1
    )
      throw new Error("Queue changed while reordering; try again");
    const reordered = [...remaining.slice(0, beforeIndex), moving, ...remaining.slice(beforeIndex)];
    const state = { ...playback.state, queue: reordered } as PlaybackState;
    await ctx.db.patch("roomPlayback", playback._id, {
      state,
      queueRevision: playback.queueRevision + 1,
    });
    return null;
  },
});

export const setLyrics = mutation({
  args: {
    roomId: v.id("rooms"),
    lyricsId: v.union(v.string(), v.null()),
    offsetMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { roomId, lyricsId, offsetMs }) => {
    await requireRoomAction(ctx, roomId, "rooms:controlPlayback");
    const playback = await playbackForRoom(ctx, roomId);
    const current = currentItem(playback.state);
    if (!current) throw new Error("Nothing is playing");
    const roomMedia = await ctx.db.get("roomMedia", current.roomMedia);
    if (!roomMedia || roomMedia.room !== roomId) throw new Error("Room media item not found");
    if (lyricsId !== null) {
      const tracks = await ctx.db
        .query("mediaLyricTracks")
        .withIndex("by_asset", (q) => q.eq("asset", current.asset))
        .take(20);
      if (!tracks.some((track) => track.source === lyricsId && track.state === "ready"))
        throw new Error("Lyrics track not found");
    }
    await ctx.db.patch("roomMedia", roomMedia._id, {
      selectedLyricsId: lyricsId ?? undefined,
      lyricsOffsetMs: Math.max(-30_000, Math.min(30_000, offsetMs)),
    });
    return null;
  },
});

async function schedulePresenceCheck(ctx: MutationCtx, playback: Doc<"roomPlayback">) {
  const checkAt = Date.now() + PRESENCE_CHECK_INTERVAL_MS;
  if (playback.state.kind === "empty") return;
  await ctx.db.patch("roomPlayback", playback._id, {
    state: { ...playback.state, presenceCheckAt: checkAt },
  });
  await ctx.scheduler.runAfter(PRESENCE_CHECK_INTERVAL_MS, internal.playback.checkPresence, {
    roomId: playback.room,
    checkAt,
  });
}

export async function markRoomOccupied(ctx: MutationCtx, roomId: Id<"rooms">) {
  const playback = await playbackForRoom(ctx, roomId);
  if (playback.state.kind !== "empty") return;
  const checkAt = Date.now() + PRESENCE_CHECK_INTERVAL_MS;
  const generation = playback.state.occupancyGeneration + 1;
  const { transport, queue } = playback.state;
  let state: PlaybackState;
  if (transport.kind === "playing") {
    state = {
      kind: "occupiedPlaying",
      occupancyGeneration: generation,
      presenceCheckAt: checkAt,
      current: transport.current,
      anchorPositionMs: transport.anchorPositionMs,
      anchorUpdatedAt: transport.anchorUpdatedAt,
      queue,
    };
  } else if (transport.kind === "paused") {
    state = {
      kind: "occupiedPaused",
      occupancyGeneration: generation,
      presenceCheckAt: checkAt,
      current: transport.current,
      anchorPositionMs: transport.anchorPositionMs,
      anchorUpdatedAt: transport.anchorUpdatedAt,
      reason: transport.reason,
      queue,
    };
  } else {
    const waiting = {
      kind: "occupiedWaiting",
      occupancyGeneration: generation,
      presenceCheckAt: checkAt,
      queue: [],
    } as Extract<PlaybackState, { kind: "occupiedWaiting" }>;
    state = promoteReadyFromOccupiedQueue(waiting, queue, Date.now());
  }
  const revision =
    playback.revision + (currentItem(state)?.key !== currentItem(playback.state)?.key ? 1 : 0);
  await ctx.db.patch("roomPlayback", playback._id, { state, revision });
  await ctx.scheduler.runAfter(PRESENCE_CHECK_INTERVAL_MS, internal.playback.checkPresence, {
    roomId,
    checkAt,
  });
  await scheduleIfNewCurrent(ctx, roomId, playback.state, state, revision);
}

async function markRoomEmpty(ctx: MutationCtx, playback: Doc<"roomPlayback">) {
  if (playback.state.kind === "empty") return;
  const now = Date.now();
  const generation = playback.state.occupancyGeneration + 1;
  const current = currentItem(playback.state);
  const timing = activeTiming(playback.state);
  const transport =
    current && timing
      ? isPlaying(playback.state)
        ? {
            kind: "playing" as const,
            current,
            anchorPositionMs: timing.anchorPositionMs,
            anchorUpdatedAt: timing.anchorUpdatedAt,
          }
        : {
            kind: "paused" as const,
            current,
            anchorPositionMs: timing.anchorPositionMs,
            anchorUpdatedAt: timing.anchorUpdatedAt,
            reason: "user" as const,
          }
      : { kind: "idle" as const };
  const state: PlaybackState = {
    kind: "empty",
    emptySince: now,
    occupancyGeneration: generation,
    transport,
    queue: queueItems(playback.state),
  };
  await ctx.db.patch("roomPlayback", playback._id, { state });
  await Promise.all([
    ctx.scheduler.runAfter(EMPTY_PAUSE_GRACE_MS, internal.playback.pauseIfEmpty, {
      roomId: playback.room,
      occupancyGeneration: generation,
    }),
    ctx.scheduler.runAfter(EMPTY_ROOM_LIFETIME_MS, internal.playback.deleteIfEmpty, {
      roomId: playback.room,
      occupancyGeneration: generation,
    }),
  ]);
}

export async function observeRoomPresence(ctx: MutationCtx, roomId: Id<"rooms">) {
  const playback = await playbackForRoom(ctx, roomId);
  const online = await presence.listRoom(ctx, roomId, true, 1);
  if (online.length > 0) await markRoomOccupied(ctx, roomId);
  else await markRoomEmpty(ctx, playback);
}

export const recordOccupied = internalMutation({
  args: { roomId: v.id("rooms") },
  returns: v.null(),
  handler: async (ctx, { roomId }) => {
    if (await ctx.db.get("rooms", roomId)) await markRoomOccupied(ctx, roomId);
    return null;
  },
});

export const observePresence = internalMutation({
  args: { roomId: v.id("rooms") },
  returns: v.null(),
  handler: async (ctx, { roomId }) => {
    if (await ctx.db.get("rooms", roomId)) await observeRoomPresence(ctx, roomId);
    return null;
  },
});

export const checkPresence = internalMutation({
  args: { roomId: v.id("rooms"), checkAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { roomId, checkAt }) => {
    const playback = await playbackForRoom(ctx, roomId);
    if (playback.state.kind === "empty" || playback.state.presenceCheckAt !== checkAt) return null;
    const online = await presence.listRoom(ctx, roomId, true, 1);
    if (online.length === 0) await markRoomEmpty(ctx, playback);
    else await schedulePresenceCheck(ctx, playback);
    return null;
  },
});

export const pauseIfEmpty = internalMutation({
  args: { roomId: v.id("rooms"), occupancyGeneration: v.number() },
  returns: v.null(),
  handler: async (ctx, { roomId, occupancyGeneration }) => {
    const playback = await playbackForRoom(ctx, roomId);
    const state = playback.state;
    if (
      state.kind !== "empty" ||
      state.occupancyGeneration !== occupancyGeneration ||
      state.transport.kind !== "playing"
    )
      return null;
    const now = Date.now();
    await ctx.db.patch("roomPlayback", playback._id, {
      state: {
        ...state,
        transport: {
          kind: "paused",
          current: state.transport.current,
          anchorPositionMs: projectedPositionMs(state, now),
          anchorUpdatedAt: now,
          reason: "room_empty",
        },
      },
      revision: playback.revision + 1,
    });
    return null;
  },
});

export const deleteIfEmpty = internalMutation({
  args: { roomId: v.id("rooms"), occupancyGeneration: v.number() },
  returns: v.null(),
  handler: async (ctx, { roomId, occupancyGeneration }) => {
    const playback = await playbackForRoom(ctx, roomId);
    if (
      playback.state.kind !== "empty" ||
      playback.state.occupancyGeneration !== occupancyGeneration
    )
      return null;
    const online = await presence.listRoom(ctx, roomId, true, 1);
    if (online.length > 0) {
      await markRoomOccupied(ctx, roomId);
      return null;
    }
    const [messages, visits, media] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_room", (q) => q.eq("room", roomId))
        .take(101),
      ctx.db
        .query("roomVisits")
        .withIndex("by_room", (q) => q.eq("room", roomId))
        .take(101),
      ctx.db
        .query("roomMedia")
        .withIndex("by_room", (q) => q.eq("room", roomId))
        .take(11),
    ]);
    await Promise.all([
      ...messages.slice(0, 100).map((row) => ctx.db.delete("messages", row._id)),
      ...visits.slice(0, 100).map((row) => ctx.db.delete("roomVisits", row._id)),
    ]);
    for (const association of media.slice(0, 10))
      await removeRoomMedia(ctx, { roomId, roomMediaId: association._id });
    if (messages.length > 100 || visits.length > 100 || media.length > 10) {
      await ctx.scheduler.runAfter(0, internal.playback.deleteIfEmpty, {
        roomId,
        occupancyGeneration,
      });
      return null;
    }
    await ctx.db.delete("roomPlayback", playback._id);
    await ctx.db.delete("rooms", roomId);
    await presence.removeRoom(ctx, roomId);
    return null;
  },
});

export const onRoomMediaReady = internalMutation({
  args: { roomMediaId: v.id("roomMedia") },
  returns: v.null(),
  handler: async (ctx, { roomMediaId }) => {
    const roomMedia = await ctx.db.get("roomMedia", roomMediaId);
    if (!roomMedia) return null;
    const playback = await playbackForRoom(ctx, roomMedia.room);
    const matching = queueItems(playback.state).find((item) => item.roomMedia === roomMediaId);
    if (!matching) return null;
    const replacement = await readyItemForRoomMedia(ctx, roomMediaId, matching);
    if (!replacement) return null;
    const state = replaceQueuedMedia(
      playback.state,
      roomMediaId,
      (item) => ({
        ...replacement,
        key: item.key,
        addedBy: item.addedBy,
        createdAt: item.createdAt,
      }),
      Date.now(),
    );
    const revision =
      playback.revision + (currentItem(state)?.key !== currentItem(playback.state)?.key ? 1 : 0);
    await ctx.db.patch("roomPlayback", playback._id, {
      state,
      revision,
      queueRevision: playback.queueRevision + 1,
    });
    await scheduleIfNewCurrent(ctx, roomMedia.room, playback.state, state, revision);
    return null;
  },
});

export const onRoomMediaFailed = internalMutation({
  args: { roomMediaId: v.id("roomMedia"), message: v.string() },
  returns: v.null(),
  handler: async (ctx, { roomMediaId, message }) => {
    const roomMedia = await ctx.db.get("roomMedia", roomMediaId);
    if (!roomMedia) return null;
    const playback = await playbackForRoom(ctx, roomMedia.room);
    const state = replaceQueuedMedia(
      playback.state,
      roomMediaId,
      (item) => ({
        key: item.key,
        roomMedia: item.roomMedia,
        addedBy: item.addedBy,
        createdAt: item.createdAt,
        kind: "failed",
        message,
      }),
      Date.now(),
    );
    await ctx.db.patch("roomPlayback", playback._id, {
      state,
      queueRevision: playback.queueRevision + 1,
    });
    return null;
  },
});
