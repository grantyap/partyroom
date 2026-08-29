import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  advanceRoomPlayback,
  enqueueRoomMedia,
  markRoomOccupied,
  updateRoomTiming,
} from "./playback";
import { defaultRoomMemberPermissions } from "./rooms.schema";
import schema from "./schema";
import { modules } from "./test.setup";

async function seedRoom(t: ReturnType<typeof convexTest>, occupied = true) {
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      owner: "owner",
      name: crypto.randomUUID(),
      memberPermissions: defaultRoomMemberPermissions,
    });
    const now = Date.now();
    const playbackId = await ctx.db.insert("roomPlayback", {
      room: roomId,
      state: occupied
        ? {
            kind: "occupiedWaiting" as const,
            occupancyGeneration: 1,
            presenceCheckAt: now + 30_000,
            queue: [],
          }
        : {
            kind: "empty" as const,
            emptySince: now,
            occupancyGeneration: 0,
            transport: { kind: "idle" as const },
            queue: [],
          },
      revision: 0,
      queueRevision: 0,
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
  if (state === "ready") await makeReady(t, result.roomMediaId);
  return result.roomMediaId;
}

async function makeReady(t: ReturnType<typeof convexTest>, roomMediaId: Id<"roomMedia">) {
  await t.run(async (ctx) => {
    const association = await ctx.db.get("roomMedia", roomMediaId);
    if (!association) throw new Error("Room media missing");
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
    await ctx.db.patch("mediaJobs", association.job, {
      state: "ready",
      stage: "ready",
      progress: 1,
      asset: assetId,
    });
    await ctx.db.patch("roomMedia", roomMediaId, { asset: assetId });
  });
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

describe("room playback aggregate", () => {
  test("duplicate media receives distinct embedded queue keys", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t, false);
    const media = await createRoomMedia(t, roomId, "processing");

    await enqueue(t, roomId, media);
    await enqueue(t, roomId, media);
    await enqueue(t, roomId, media);

    const playback = await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId));
    expect(playback?.state.queue).toHaveLength(3);
    expect(new Set(playback?.state.queue.map(({ key }) => key)).size).toBe(3);
  });

  test("ready media is promoted in the same enqueue transaction", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t);
    const media = await createRoomMedia(t, roomId, "ready");
    const key = await enqueue(t, roomId, media);

    const playback = await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId));
    expect(playback?.state).toMatchObject({
      kind: "occupiedPlaying",
      current: { key, kind: "ready", title: "Ready song" },
      queue: [],
    });
  });

  test("processing media becomes current atomically when it becomes ready", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t);
    const media = await createRoomMedia(t, roomId, "processing");
    const key = await enqueue(t, roomId, media);
    await makeReady(t, media);

    await t.mutation(internal.playback.onRoomMediaReady, { roomMediaId: media });

    const playback = await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId));
    expect(playback?.state).toMatchObject({
      kind: "occupiedPlaying",
      current: { key, kind: "ready" },
      queue: [],
    });
  });

  test("an empty room may hold ready media and promotes it when occupied", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t, false);
    const media = await createRoomMedia(t, roomId, "ready");
    const key = await enqueue(t, roomId, media);

    expect(await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId))).toMatchObject({
      state: { kind: "empty", transport: { kind: "idle" }, queue: [{ key, kind: "ready" }] },
    });

    await t.run(async (ctx) => await markRoomOccupied(ctx, roomId));

    expect(await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId))).toMatchObject({
      state: { kind: "occupiedPlaying", current: { key }, queue: [] },
    });
  });

  test("advancement skips processing entries without moving them", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t);
    const readyA = await createRoomMedia(t, roomId, "ready");
    const processingB = await createRoomMedia(t, roomId, "processing");
    const readyC = await createRoomMedia(t, roomId, "ready");
    const keyA = await enqueue(t, roomId, readyA);
    const keyB = await enqueue(t, roomId, processingB);
    const keyC = await enqueue(t, roomId, readyC);

    await t.run(async (ctx) => await advanceRoomPlayback(ctx, { roomId, currentKey: keyA }));

    const playback = await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId));
    expect(playback?.state).toMatchObject({
      kind: "occupiedPlaying",
      current: { key: keyC },
      queue: [{ key: keyB, kind: "processing" }],
    });
  });

  test("timing updates preserve a complete current snapshot", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t);
    const media = await createRoomMedia(t, roomId, "ready");
    const currentKey = await enqueue(t, roomId, media);

    await t.run(
      async (ctx) =>
        await updateRoomTiming(
          ctx,
          { roomId, currentKey, update: { position: 12.5, velocity: 0 } },
          100_000,
        ),
    );

    expect(await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId))).toMatchObject({
      state: {
        kind: "occupiedPaused",
        current: { key: currentKey, kind: "ready" },
        anchorPositionMs: 12_500,
        anchorUpdatedAt: 100_000,
      },
    });
  });
});
