import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { advanceRoomPlayback, enqueueRoomMedia, updateRoomTiming } from "./playback";
import { defaultRoomMemberPermissions } from "./rooms.schema";
import schema from "./schema";
import { modules } from "./test.setup";

async function seedRoom(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      owner: "owner",
      name: crypto.randomUUID(),
      memberPermissions: defaultRoomMemberPermissions,
    });
    const playbackId = await ctx.db.insert("roomPlayback", {
      room: roomId,
      status: "idle",
      anchorPositionMs: 0,
      anchorUpdatedAt: Date.now(),
      revision: 0,
      queueRevision: 0,
      occupancyGeneration: 1,
    });
    return { roomId, playbackId };
  });
}

async function createRoomMedia(
  t: ReturnType<typeof convexTest>,
  roomId: Id<"rooms">,
  state: "ready" | "processing",
) {
  const result = await t.mutation(internal.media.jobs.createOrJoin, {
    roomId,
    requestedBy: "user",
    requestKey: crypto.randomUUID(),
    encryptedSource: "ciphertext",
    sourceIv: "iv",
  });
  if (state === "ready") {
    await t.run(async (ctx) => {
      const now = Date.now();
      const assetId = await ctx.db.insert("mediaAssets", {
        cacheKey: crypto.randomUUID(),
        extractor: "test",
        sourceId: crypto.randomUUID(),
        state: "ready",
        title: "Ready song",
        duration: 180,
        finalArtifactId: "video-artifact",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch("mediaJobs", result.jobId, {
        state: "ready",
        stage: "ready",
        progress: 1,
        asset: assetId,
      });
      await ctx.db.patch("roomMedia", result.roomMediaId, { asset: assetId });
    });
  }
  return result.roomMediaId;
}

async function enqueue(
  t: ReturnType<typeof convexTest>,
  roomId: Id<"rooms">,
  roomMediaId: Id<"roomMedia">,
) {
  return await t.run(
    async (ctx) => await enqueueRoomMedia(ctx, { roomId, roomMediaId, addedBy: "user" }),
  );
}

describe("room playback", () => {
  test("fractional ranks preserve insertion order for duplicate media", async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await seedRoom(t);
    const media = await createRoomMedia(t, roomId, "processing");

    await enqueue(t, roomId, media);
    await enqueue(t, roomId, media);
    await enqueue(t, roomId, media);

    const items = await t.run(
      async (ctx) =>
        await ctx.db
          .query("roomQueueItems")
          .withIndex("by_room_and_rank", (q) => q.eq("room", roomId))
          .collect(),
    );
    expect(items).toHaveLength(3);
    expect(new Set(items.map(({ rank }) => rank)).size).toBe(3);
    expect(items.map(({ createdAt }) => createdAt)).toEqual(
      [...items].map(({ createdAt }) => createdAt).sort((a, b) => a - b),
    );
  });

  test("advancement skips processing entries without moving them", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t);
    const readyA = await createRoomMedia(t, roomId, "ready");
    const processingB = await createRoomMedia(t, roomId, "processing");
    const readyC = await createRoomMedia(t, roomId, "ready");
    const itemA = await enqueue(t, roomId, readyA);
    const itemB = await enqueue(t, roomId, processingB);
    const itemC = await enqueue(t, roomId, readyC);

    await t.run(
      async (ctx) =>
        await advanceRoomPlayback(ctx, {
          roomId,
          currentQueueItem: itemA,
          expectedRevision: 1,
        }),
    );

    const result = await t.run(async (ctx) => ({
      playback: await ctx.db.get("roomPlayback", playbackId),
      firstPending: await ctx.db.get("roomQueueItems", itemB),
      nowPlaying: await ctx.db.get("roomQueueItems", itemC),
      played: await ctx.db.get("roomQueueItems", itemA),
    }));
    expect(result.playback).toMatchObject({ currentQueueItem: itemC, status: "playing" });
    expect(result.firstPending).toMatchObject({ _id: itemB });
    expect(result.nowPlaying).toMatchObject({ _id: itemC });
    expect(result.played).toBeNull();
  });

  test("a processing-only queue starts when its media becomes ready", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t);
    const roomMediaId = await createRoomMedia(t, roomId, "processing");
    const queueItemId = await enqueue(t, roomId, roomMediaId);
    const association = await t.run(async (ctx) => await ctx.db.get("roomMedia", roomMediaId));
    await t.run(async (ctx) => {
      const now = Date.now();
      const assetId = await ctx.db.insert("mediaAssets", {
        cacheKey: crypto.randomUUID(),
        extractor: "test",
        sourceId: crypto.randomUUID(),
        state: "ready",
        duration: 120,
        finalArtifactId: "video-artifact",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch("mediaJobs", association!.job, {
        state: "ready",
        stage: "ready",
        progress: 1,
        asset: assetId,
      });
      await ctx.db.patch("roomMedia", roomMediaId, { asset: assetId });
    });

    await t.mutation(internal.playback.onRoomMediaReady, { roomMediaId });

    expect(await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId))).toMatchObject({
      currentQueueItem: queueItemId,
      status: "playing",
    });
  });

  test("forward playback is future-dated so clients share one start instant", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t);
    const media = await createRoomMedia(t, roomId, "ready");
    const currentQueueItem = await enqueue(t, roomId, media);

    await t.run(async (ctx) => {
      await ctx.db.patch("roomPlayback", playbackId, {
        status: "playing",
        anchorPositionMs: 10_000,
        anchorUpdatedAt: 100_000,
        revision: 5,
      });
    });

    await t.run(
      async (ctx) =>
        await updateRoomTiming(ctx, { roomId, currentQueueItem, update: { velocity: 0 } }, 102_500),
    );
    expect(await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId))).toMatchObject({
      status: "paused",
      anchorPositionMs: 12_500,
      anchorUpdatedAt: 102_500,
      revision: 6,
    });

    await t.run(
      async (ctx) =>
        await updateRoomTiming(ctx, { roomId, currentQueueItem, update: { velocity: 1 } }, 104_000),
    );
    expect(await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId))).toMatchObject({
      status: "playing",
      anchorPositionMs: 12_500,
      anchorUpdatedAt: 105_000,
      revision: 7,
    });
  });

  test("a playing position update receives a coordinated future start", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t);
    const media = await createRoomMedia(t, roomId, "ready");
    const currentQueueItem = await enqueue(t, roomId, media);

    await t.run(async (ctx) => {
      await ctx.db.patch("roomPlayback", playbackId, {
        status: "playing",
        anchorPositionMs: 5_000,
        anchorUpdatedAt: 90_000,
        revision: 4,
      });
      await updateRoomTiming(
        ctx,
        {
          roomId,
          currentQueueItem,
          update: { position: 30 },
          playStartDelayMs: 250,
        },
        100_075,
      );
    });

    expect(await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId))).toMatchObject({
      status: "playing",
      anchorPositionMs: 30_000,
      anchorUpdatedAt: 100_325,
      revision: 5,
    });
  });
});
