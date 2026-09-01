import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";

const MIGRATION_BATCH_SIZE = 500;

type PlaybackState = Doc<"roomPlayback">["state"];
type QueueItem = PlaybackState["queue"][number];

function replaceUserInQueueItem<T extends QueueItem>(
  item: T,
  fromUserId: string,
  toUserId: string,
): { item: T; changed: boolean } {
  if (item.addedBy !== fromUserId) {
    return { item, changed: false };
  }

  return { item: { ...item, addedBy: toUserId } as T, changed: true };
}

function replaceUserInPlaybackState(
  state: PlaybackState,
  fromUserId: string,
  toUserId: string,
): { state: PlaybackState; changed: boolean } {
  let changed = false;
  const replace = <T extends QueueItem>(item: T) => {
    const result = replaceUserInQueueItem(item, fromUserId, toUserId);
    changed ||= result.changed;
    return result.item;
  };

  if (state.kind === "occupiedPlaying" || state.kind === "occupiedPaused") {
    return {
      state: {
        ...state,
        current: replace(state.current),
        queue: state.queue.map(replace),
      } as PlaybackState,
      changed,
    };
  }

  if (state.kind === "empty" && state.transport.kind !== "idle") {
    return {
      state: {
        ...state,
        transport: {
          ...state.transport,
          current: replace(state.transport.current),
        },
        queue: state.queue.map(replace),
      } as PlaybackState,
      changed,
    };
  }

  return {
    state: {
      ...state,
      queue: state.queue.map(replace),
    } as PlaybackState,
    changed,
  };
}

async function migrateUserDataBatch(ctx: MutationCtx, fromUserId: string, toUserId: string) {
  const visits = await ctx.db
    .query("roomVisits")
    .withIndex("by_user_and_last_visited_at", (q) => q.eq("user", fromUserId))
    .order("desc")
    .take(MIGRATION_BATCH_SIZE + 1);

  const rooms = await ctx.db
    .query("rooms")
    .withIndex("by_owner", (q) => q.eq("owner", fromUserId))
    .take(MIGRATION_BATCH_SIZE + 1);

  const roomIds = new Set([
    ...visits.map((visit) => visit.room),
    ...rooms.map((room) => room._id),
  ]);
  for (const room of rooms.slice(0, MIGRATION_BATCH_SIZE)) {
    await ctx.db.patch("rooms", room._id, { owner: toUserId });
  }

  for (const visit of visits.slice(0, MIGRATION_BATCH_SIZE)) {
    const existingVisit = await ctx.db
      .query("roomVisits")
      .withIndex("by_room_and_user", (q) => q.eq("room", visit.room).eq("user", toUserId))
      .first();

    if (existingVisit) {
      await ctx.db.patch("roomVisits", existingVisit._id, {
        lastVisitedAt: Math.max(existingVisit.lastVisitedAt, visit.lastVisitedAt),
      });
      await ctx.db.delete("roomVisits", visit._id);
    } else {
      await ctx.db.patch("roomVisits", visit._id, { user: toUserId });
    }
  }

  const messages = await ctx.db
    .query("messages")
    .withIndex("by_user", (q) => q.eq("user", fromUserId))
    .take(MIGRATION_BATCH_SIZE + 1);
  for (const message of messages.slice(0, MIGRATION_BATCH_SIZE)) {
    await ctx.db.patch("messages", message._id, { user: toUserId });
  }

  const mediaJobs = await ctx.db
    .query("mediaJobs")
    .withIndex("by_requested_by", (q) => q.eq("requestedBy", fromUserId))
    .take(MIGRATION_BATCH_SIZE + 1);
  for (const job of mediaJobs.slice(0, MIGRATION_BATCH_SIZE)) {
    await ctx.db.patch("mediaJobs", job._id, { requestedBy: toUserId });
  }

  const roomMedia = await ctx.db
    .query("roomMedia")
    .withIndex("by_requested_by", (q) => q.eq("requestedBy", fromUserId))
    .take(MIGRATION_BATCH_SIZE + 1);
  for (const media of roomMedia.slice(0, MIGRATION_BATCH_SIZE)) {
    await ctx.db.patch("roomMedia", media._id, { requestedBy: toUserId });
  }

  for (const roomId of roomIds) {
    const playback = await ctx.db
      .query("roomPlayback")
      .withIndex("by_room", (q) => q.eq("room", roomId))
      .first();
    if (!playback) continue;

    const replacement = replaceUserInPlaybackState(playback.state, fromUserId, toUserId);
    if (replacement.changed) {
      await ctx.db.patch("roomPlayback", playback._id, { state: replacement.state });
    }
  }

  const hasMore =
    visits.length > MIGRATION_BATCH_SIZE ||
    rooms.length > MIGRATION_BATCH_SIZE ||
    messages.length > MIGRATION_BATCH_SIZE ||
    mediaJobs.length > MIGRATION_BATCH_SIZE ||
    roomMedia.length > MIGRATION_BATCH_SIZE;

  return hasMore;
}

export const migrateUserData = internalMutation({
  args: {
    fromUserId: v.string(),
    toUserId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { fromUserId, toUserId }) => {
    if (fromUserId === toUserId) return null;

    const hasMore = await migrateUserDataBatch(ctx, fromUserId, toUserId);
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.userData.migrateUserData, {
        fromUserId,
        toUserId,
      });
    }

    return null;
  },
});
