import { generateKeyBetween } from "fractional-indexing";
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
import { removeRoomMedia } from "./media/domain/jobs";
import { presence } from "./presence";
import { requireRoomAction, userHasRoomPermission, type RoomPermission } from "./rooms";

const PRESENCE_CHECK_INTERVAL_MS = 30_000;
const EMPTY_PAUSE_GRACE_MS = 15_000;
const EMPTY_ROOM_LIFETIME_MS = 10 * 60_000;
const MAX_QUEUE_ITEMS = 200;
const DEFAULT_PLAY_START_DELAY_MS = 1_000;

const playbackStatus = v.union(v.literal("idle"), v.literal("playing"), v.literal("paused"));
const queueAvailability = v.union(v.literal("ready"), v.literal("processing"), v.literal("failed"));
const queueItemResult = v.object({
  _id: v.id("roomQueueItems"),
  roomMedia: v.id("roomMedia"),
  rank: v.string(),
  addedBy: v.string(),
  createdAt: v.number(),
  availability: queueAvailability,
});
const playbackResult = v.object({
  currentQueueItem: v.optional(v.id("roomQueueItems")),
  vector: v.object({
    position: v.number(),
    velocity: v.number(),
    acceleration: v.number(),
    timestamp: v.number(),
  }),
  revision: v.number(),
  queueRevision: v.number(),
});
const permissionsResult = v.object({
  controlPlayback: v.boolean(),
  addToQueue: v.boolean(),
  reorderQueue: v.boolean(),
  removeFromQueue: v.boolean(),
  sendChat: v.boolean(),
  updateRoom: v.boolean(),
});

async function playbackForRoom(ctx: QueryCtx | MutationCtx, roomId: Id<"rooms">) {
  const playback = await ctx.db
    .query("roomPlayback")
    .withIndex("by_room", (q) => q.eq("room", roomId))
    .unique();
  if (!playback) throw new Error("Room playback state not found");
  return playback;
}

async function queueItemsForRoom(ctx: QueryCtx | MutationCtx, roomId: Id<"rooms">) {
  return await ctx.db
    .query("roomQueueItems")
    .withIndex("by_room_and_rank", (q) => q.eq("room", roomId))
    .take(MAX_QUEUE_ITEMS);
}

async function mediaAvailability(ctx: QueryCtx | MutationCtx, roomMedia: Doc<"roomMedia">) {
  const job = await ctx.db.get("mediaJobs", roomMedia.job);
  if (job?.state === "ready") {
    const assetId = roomMedia.asset ?? job.asset;
    const asset = assetId ? await ctx.db.get("mediaAssets", assetId) : null;
    if (asset?.finalArtifactId) return "ready" as const;
  }
  if (job?.state === "queued" || job?.state === "processing") return "processing" as const;
  return "failed" as const;
}

async function queueItemAvailability(ctx: QueryCtx | MutationCtx, item: Doc<"roomQueueItems">) {
  const roomMedia = await ctx.db.get("roomMedia", item.roomMedia);
  if (!roomMedia || roomMedia.room !== item.room) return "failed" as const;
  return await mediaAvailability(ctx, roomMedia);
}

async function firstReadyQueueItem(ctx: QueryCtx | MutationCtx, roomId: Id<"rooms">) {
  for (const item of await queueItemsForRoom(ctx, roomId)) {
    if ((await queueItemAvailability(ctx, item)) === "ready") return item;
  }
  return null;
}

async function queueItemDurationMs(ctx: QueryCtx | MutationCtx, item: Doc<"roomQueueItems">) {
  const roomMedia = await ctx.db.get("roomMedia", item.roomMedia);
  if (!roomMedia) return null;
  const job = await ctx.db.get("mediaJobs", roomMedia.job);
  const assetId = roomMedia.asset ?? job?.asset;
  const asset = assetId ? await ctx.db.get("mediaAssets", assetId) : null;
  return asset?.duration ? asset.duration * 1_000 : null;
}

async function scheduleAutomaticAdvance(
  ctx: MutationCtx,
  item: Doc<"roomQueueItems">,
  revision: number,
  positionMs: number,
  startDelayMs = 0,
) {
  const durationMs = await queueItemDurationMs(ctx, item);
  if (durationMs === null) return;
  await ctx.scheduler.runAfter(
    startDelayMs + Math.max(0, durationMs - positionMs),
    internal.playback.finishIfCurrent,
    {
      roomId: item.room,
      currentQueueItem: item._id,
      expectedRevision: revision,
    },
  );
}

async function startFirstReadyIfIdle(
  ctx: MutationCtx,
  playback: Doc<"roomPlayback">,
  now = Date.now(),
) {
  if (playback.currentQueueItem || playback.emptySince !== undefined) return false;
  const next = await firstReadyQueueItem(ctx, playback.room);
  if (!next) return false;
  await ctx.db.patch("roomPlayback", playback._id, {
    currentQueueItem: next._id,
    status: "playing",
    anchorPositionMs: 0,
    anchorUpdatedAt: now,
    revision: playback.revision + 1,
  });
  await scheduleAutomaticAdvance(ctx, next, playback.revision + 1, 0);
  return true;
}

/**
 * Queries the persisted timing resource at `now` using its state vector.
 * Partyroom only supports velocity 0 or 1 and acceleration 0, but exposes the
 * complete W3C four-tuple so clients consume a genuine timing source rather
 * than treating a browser playhead as shared state.
 *
 * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#media-elements-and-the-timing-object
 */
function projectedPositionMs(playback: Doc<"roomPlayback">, now: number) {
  if (playback.status !== "playing") return playback.anchorPositionMs;
  return Math.max(0, playback.anchorPositionMs + Math.max(0, now - playback.anchorUpdatedAt));
}

function userCan(room: Doc<"rooms">, userId: string, permission: RoomPermission) {
  return userHasRoomPermission({ user: userId, room, permission });
}

export const get = query({
  args: { roomId: v.id("rooms") },
  returns: v.object({
    playback: playbackResult,
    current: v.union(queueItemResult, v.null()),
    queue: v.array(queueItemResult),
    permissions: permissionsResult,
  }),
  handler: async (ctx, { roomId }) => {
    const { room, user } = await requireRoomAction(ctx, roomId, "rooms:read");
    const playback = await playbackForRoom(ctx, roomId);
    const items = await queueItemsForRoom(ctx, roomId);
    const results = await Promise.all(
      items.map(async (item) => ({
        _id: item._id,
        roomMedia: item.roomMedia,
        rank: item.rank,
        addedBy: item.addedBy,
        createdAt: item.createdAt,
        availability: await queueItemAvailability(ctx, item),
      })),
    );
    const current = results.find((item) => item._id === playback.currentQueueItem) ?? null;
    return {
      playback: {
        currentQueueItem: playback.currentQueueItem,
        vector: {
          position: playback.anchorPositionMs / 1_000,
          velocity: playback.status === "playing" ? 1 : 0,
          acceleration: 0,
          timestamp: playback.anchorUpdatedAt / 1_000,
        },
        revision: playback.revision,
        queueRevision: playback.queueRevision,
      },
      current,
      queue: results.filter((item) => item._id !== playback.currentQueueItem),
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
  const last = await ctx.db
    .query("roomQueueItems")
    .withIndex("by_room_and_rank", (q) => q.eq("room", args.roomId))
    .order("desc")
    .first();
  const itemId = await ctx.db.insert("roomQueueItems", {
    room: args.roomId,
    roomMedia: args.roomMediaId,
    rank: generateKeyBetween(last?.rank ?? null, null),
    addedBy: args.addedBy,
    createdAt: Date.now(),
  });
  await ctx.db.patch("roomPlayback", playback._id, {
    queueRevision: playback.queueRevision + 1,
  });
  const updated = (await ctx.db.get("roomPlayback", playback._id))!;
  await startFirstReadyIfIdle(ctx, updated);
  return itemId;
}

export const add = mutation({
  args: { roomId: v.id("rooms"), roomMediaId: v.id("roomMedia") },
  returns: v.id("roomQueueItems"),
  handler: async (ctx, args) => {
    const { user } = await requireRoomAction(ctx, args.roomId, "rooms:addToQueue");
    return await enqueueRoomMedia(ctx, { ...args, addedBy: user._id });
  },
});

export type TimingStateVectorUpdate = {
  position?: number;
  velocity?: number;
  acceleration?: number;
};

/**
 * Applies a partial W3C Timing Object state-vector update. Omitted fields are
 * queried from the current vector, and the resulting vector is multicast
 * through the reactive `get` query. A vector that starts forward playback is
 * timestamped slightly in the future so every client can prepare its decoder
 * and activate against one shared provider-clock instant.
 *
 * Partyroom currently supports media's forward-play and paused states only:
 * velocity must be 0 or 1 and acceleration must be 0.
 *
 * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#process-an-update-operation-timing-provider
 */
export async function updateRoomTiming(
  ctx: MutationCtx,
  {
    roomId,
    currentQueueItem,
    update,
    playStartDelayMs = DEFAULT_PLAY_START_DELAY_MS,
  }: {
    roomId: Id<"rooms">;
    currentQueueItem: Id<"roomQueueItems">;
    update: TimingStateVectorUpdate;
    playStartDelayMs?: number;
  },
  now = Date.now(),
) {
  if (
    update.position === undefined &&
    update.velocity === undefined &&
    update.acceleration === undefined
  ) {
    throw new Error("A timing update must change at least one vector component");
  }
  if (update.position !== undefined && (!Number.isFinite(update.position) || update.position < 0)) {
    throw new Error("Timing position must be a finite non-negative number");
  }
  if (update.velocity !== undefined && update.velocity !== 0 && update.velocity !== 1) {
    throw new Error("Partyroom only supports timing velocity 0 or 1");
  }
  if (update.acceleration !== undefined && update.acceleration !== 0) {
    throw new Error("Partyroom only supports timing acceleration 0");
  }
  if (!Number.isFinite(playStartDelayMs) || playStartDelayMs < 0) {
    throw new Error("Playback start delay must be a finite non-negative number");
  }

  const playback = await playbackForRoom(ctx, roomId);
  if (playback.currentQueueItem !== currentQueueItem) return;
  const positionMs =
    update.position === undefined ? projectedPositionMs(playback, now) : update.position * 1_000;
  const velocity = update.velocity ?? (playback.status === "playing" ? 1 : 0);
  const startDelayMs = velocity === 1 ? playStartDelayMs : 0;
  await ctx.db.patch("roomPlayback", playback._id, {
    status: velocity === 1 ? "playing" : "paused",
    anchorPositionMs: positionMs,
    anchorUpdatedAt: now + startDelayMs,
    revision: playback.revision + 1,
  });
  if (velocity === 1) {
    const item = await ctx.db.get("roomQueueItems", playback.currentQueueItem);
    if (item) {
      await scheduleAutomaticAdvance(ctx, item, playback.revision + 1, positionMs, startDelayMs);
    }
  }
}

/**
 * Requests an update to the room's online timing resource. Per the W3C model,
 * this mutation only forwards the request; clients update their local timing
 * object after the resulting vector arrives through `get`.
 *
 * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#state-vector-synchronization
 */
export const update = mutation({
  args: {
    roomId: v.id("rooms"),
    currentQueueItem: v.id("roomQueueItems"),
    vector: v.object({
      position: v.optional(v.number()),
      velocity: v.optional(v.number()),
      acceleration: v.optional(v.number()),
    }),
    playStartDelaySeconds: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { roomId, currentQueueItem, vector, playStartDelaySeconds }) => {
    await requireRoomAction(ctx, roomId, "rooms:controlPlayback");
    await updateRoomTiming(ctx, {
      roomId,
      currentQueueItem,
      update: vector,
      playStartDelayMs:
        playStartDelaySeconds === undefined ? undefined : playStartDelaySeconds * 1_000,
    });
    return null;
  },
});

export async function advanceRoomPlayback(
  ctx: MutationCtx,
  args: {
    roomId: Id<"rooms">;
    currentQueueItem: Id<"roomQueueItems">;
    expectedRevision?: number;
  },
) {
  const playback = await playbackForRoom(ctx, args.roomId);
  if (
    (args.expectedRevision !== undefined && playback.revision !== args.expectedRevision) ||
    playback.currentQueueItem !== args.currentQueueItem
  ) {
    return;
  }
  await ctx.db.delete("roomQueueItems", args.currentQueueItem);
  const next = await firstReadyQueueItem(ctx, args.roomId);
  const now = Date.now();
  await ctx.db.patch("roomPlayback", playback._id, {
    currentQueueItem: next?._id,
    status: next ? "playing" : "idle",
    anchorPositionMs: 0,
    anchorUpdatedAt: now,
    revision: playback.revision + 1,
    queueRevision: playback.queueRevision + 1,
  });
  if (next) await scheduleAutomaticAdvance(ctx, next, playback.revision + 1, 0);
}

export const advance = mutation({
  args: {
    roomId: v.id("rooms"),
    currentQueueItem: v.id("roomQueueItems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRoomAction(ctx, args.roomId, "rooms:controlPlayback");
    await advanceRoomPlayback(ctx, args);
    return null;
  },
});

export const finishIfCurrent = internalMutation({
  args: {
    roomId: v.id("rooms"),
    currentQueueItem: v.id("roomQueueItems"),
    expectedRevision: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const playback = await ctx.db
      .query("roomPlayback")
      .withIndex("by_room", (q) => q.eq("room", args.roomId))
      .unique();
    if (playback?.status === "playing") await advanceRoomPlayback(ctx, args);
    return null;
  },
});

export const remove = mutation({
  args: { roomId: v.id("rooms"), queueItemId: v.id("roomQueueItems") },
  returns: v.null(),
  handler: async (ctx, { roomId, queueItemId }) => {
    await requireRoomAction(ctx, roomId, "rooms:removeFromQueue");
    const playback = await playbackForRoom(ctx, roomId);
    if (playback.currentQueueItem === queueItemId) {
      throw new Error("The currently playing item cannot be removed; skip it instead");
    }
    const item = await ctx.db.get("roomQueueItems", queueItemId);
    if (!item || item.room !== roomId) throw new Error("Queue item not found");
    await ctx.db.delete("roomQueueItems", queueItemId);
    await ctx.db.patch("roomPlayback", playback._id, {
      queueRevision: playback.queueRevision + 1,
    });
    return null;
  },
});

export const reorder = mutation({
  args: {
    roomId: v.id("rooms"),
    queueItemId: v.id("roomQueueItems"),
    afterItemId: v.union(v.id("roomQueueItems"), v.null()),
    beforeItemId: v.union(v.id("roomQueueItems"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { roomId, queueItemId, afterItemId, beforeItemId }) => {
    await requireRoomAction(ctx, roomId, "rooms:reorderQueue");
    const playback = await playbackForRoom(ctx, roomId);
    if (playback.currentQueueItem === queueItemId) throw new Error("Current item cannot be moved");
    const items = (await queueItemsForRoom(ctx, roomId)).filter(
      (item) => item._id !== playback.currentQueueItem && item._id !== queueItemId,
    );
    const item = await ctx.db.get("roomQueueItems", queueItemId);
    if (!item || item.room !== roomId) throw new Error("Queue item not found");
    const afterIndex =
      afterItemId === null ? -1 : items.findIndex((row) => row._id === afterItemId);
    const beforeIndex =
      beforeItemId === null ? items.length : items.findIndex((row) => row._id === beforeItemId);
    if (
      (afterItemId !== null && afterIndex < 0) ||
      (beforeItemId !== null && beforeIndex < 0) ||
      beforeIndex !== afterIndex + 1
    ) {
      throw new Error("Queue changed while reordering; try again");
    }
    const rank = generateKeyBetween(
      afterIndex >= 0 ? items[afterIndex].rank : null,
      beforeIndex < items.length ? items[beforeIndex].rank : null,
    );
    await ctx.db.patch("roomQueueItems", queueItemId, { rank });
    await ctx.db.patch("roomPlayback", playback._id, {
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
    if (!playback.currentQueueItem) throw new Error("Nothing is playing");
    const item = await ctx.db.get("roomQueueItems", playback.currentQueueItem);
    if (!item || item.room !== roomId) throw new Error("Current queue item not found");
    const roomMedia = await ctx.db.get("roomMedia", item.roomMedia);
    if (!roomMedia || roomMedia.room !== roomId) throw new Error("Room media item not found");
    if (lyricsId !== null) {
      const job = await ctx.db.get("mediaJobs", roomMedia.job);
      const assetId = roomMedia.asset ?? job?.asset;
      const tracks = assetId
        ? await ctx.db
            .query("mediaLyricTracks")
            .withIndex("by_asset", (q) => q.eq("asset", assetId))
            .take(20)
        : [];
      if (!tracks.some((track) => track.source === lyricsId && track.state === "ready")) {
        throw new Error("Lyrics track not found");
      }
    }
    await ctx.db.patch("roomMedia", roomMedia._id, {
      selectedLyricsId: lyricsId ?? undefined,
      lyricsOffsetMs: Math.max(-30_000, Math.min(30_000, offsetMs)),
    });
    return null;
  },
});

async function schedulePresenceCheck(
  ctx: MutationCtx,
  playback: Doc<"roomPlayback">,
  delay = PRESENCE_CHECK_INTERVAL_MS,
) {
  const checkAt = Date.now() + delay;
  await ctx.db.patch("roomPlayback", playback._id, { presenceCheckAt: checkAt });
  await ctx.scheduler.runAfter(delay, internal.playback.checkPresence, {
    roomId: playback.room,
    checkAt,
  });
}

export async function markRoomOccupied(ctx: MutationCtx, roomId: Id<"rooms">) {
  let playback = await playbackForRoom(ctx, roomId);
  if (playback.emptySince !== undefined) {
    await ctx.db.patch("roomPlayback", playback._id, {
      emptySince: undefined,
      occupancyGeneration: playback.occupancyGeneration + 1,
    });
    playback = (await ctx.db.get("roomPlayback", playback._id))!;
    await startFirstReadyIfIdle(ctx, playback);
  }
  if (playback.presenceCheckAt === undefined) await schedulePresenceCheck(ctx, playback);
}

async function markRoomEmpty(ctx: MutationCtx, playback: Doc<"roomPlayback">) {
  if (playback.emptySince !== undefined) return;
  const now = Date.now();
  const occupancyGeneration = playback.occupancyGeneration + 1;
  await ctx.db.patch("roomPlayback", playback._id, {
    emptySince: now,
    occupancyGeneration,
    presenceCheckAt: undefined,
  });
  await Promise.all([
    ctx.scheduler.runAfter(EMPTY_PAUSE_GRACE_MS, internal.playback.pauseIfEmpty, {
      roomId: playback.room,
      occupancyGeneration,
    }),
    ctx.scheduler.runAfter(EMPTY_ROOM_LIFETIME_MS, internal.playback.deleteIfEmpty, {
      roomId: playback.room,
      occupancyGeneration,
    }),
  ]);
}

export async function observeRoomPresence(ctx: MutationCtx, roomId: Id<"rooms">) {
  const playback = await playbackForRoom(ctx, roomId);
  const online = await presence.listRoom(ctx, roomId, true, 1);
  if (online.length > 0) {
    await markRoomOccupied(ctx, roomId);
  } else {
    await markRoomEmpty(ctx, playback);
  }
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
    const playback = await ctx.db
      .query("roomPlayback")
      .withIndex("by_room", (q) => q.eq("room", roomId))
      .unique();
    if (!playback || playback.presenceCheckAt !== checkAt) return null;
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
    const playback = await ctx.db
      .query("roomPlayback")
      .withIndex("by_room", (q) => q.eq("room", roomId))
      .unique();
    if (
      !playback ||
      playback.emptySince === undefined ||
      playback.occupancyGeneration !== occupancyGeneration ||
      playback.status !== "playing"
    ) {
      return null;
    }
    const now = Date.now();
    await ctx.db.patch("roomPlayback", playback._id, {
      status: "paused",
      anchorPositionMs: projectedPositionMs(playback, now),
      anchorUpdatedAt: now,
      revision: playback.revision + 1,
    });
    return null;
  },
});

export const deleteIfEmpty = internalMutation({
  args: { roomId: v.id("rooms"), occupancyGeneration: v.number() },
  returns: v.null(),
  handler: async (ctx, { roomId, occupancyGeneration }) => {
    const playback = await ctx.db
      .query("roomPlayback")
      .withIndex("by_room", (q) => q.eq("room", roomId))
      .unique();
    if (
      !playback ||
      playback.emptySince === undefined ||
      playback.occupancyGeneration !== occupancyGeneration
    ) {
      return null;
    }
    const online = await presence.listRoom(ctx, roomId, true, 1);
    if (online.length > 0) {
      await markRoomOccupied(ctx, roomId);
      return null;
    }

    const [queue, messages, visits, media] = await Promise.all([
      ctx.db
        .query("roomQueueItems")
        .withIndex("by_room_and_rank", (q) => q.eq("room", roomId))
        .take(101),
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
      ...queue.slice(0, 100).map((row) => ctx.db.delete("roomQueueItems", row._id)),
      ...messages.slice(0, 100).map((row) => ctx.db.delete("messages", row._id)),
      ...visits.slice(0, 100).map((row) => ctx.db.delete("roomVisits", row._id)),
    ]);
    for (const association of media.slice(0, 10)) {
      await removeRoomMedia(ctx, { roomId, roomMediaId: association._id });
    }
    if (queue.length > 100 || messages.length > 100 || visits.length > 100 || media.length > 10) {
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
    await startFirstReadyIfIdle(ctx, playback);
    return null;
  },
});
