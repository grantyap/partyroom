import { convexTest } from "convex-test";
import type { WorkflowId } from "@convex-dev/workflow";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { authComponent } from "./auth";
import type { Id } from "./_generated/dataModel";
import { requeueRoomMedia } from "./media/domain/jobs";
import {
  advanceRoomPlayback,
  enqueueRoomMedia,
  markRoomOccupied,
  updateRoomTiming,
  transposeRoomPlayback,
} from "./playback";
import { defaultRoomMemberPermissions } from "./rooms.schema";
import schema from "./schema";
import { modules } from "./test.setup";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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
      workflowId: "workflow",

      asset: assetId,
    });
    await ctx.db.patch("roomMedia", roomMediaId, { asset: assetId });
  });
}

async function delayedReadySetup() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const { roomId, playbackId } = await seedRoom(t);
  const roomMediaId = await createRoomMedia(t, roomId, "processing");
  const key = await enqueue(t, roomId, roomMediaId);
  await makeReady(t, roomMediaId);
  const published = (await t.run((ctx) => ctx.db.get("roomMedia", roomMediaId)))!;
  const jobId = await t.run((ctx) => requeueRoomMedia(ctx, { roomId, roomMediaId }));
  await t.mutation(internal.media.jobs.attachWorkflow, {
    jobId,
    workflowId: "rebuild" as WorkflowId,
  });
  return { t, roomId, playbackId, roomMediaId, key, published, jobId };
}

async function advancementJobs(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect())
      .filter((job) => job.name === "playback:finishIfCurrent")
      .map((job) => job.args[0]),
  );
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

    const association = await t.run(async (ctx) => await ctx.db.get("roomMedia", media));
    await t.mutation(internal.playback.onRoomMediaReady, {
      roomMediaId: media,
      jobId: association!.job,
      assetId: association!.asset!,
    });

    const playback = await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId));
    expect(playback?.state).toMatchObject({
      kind: "occupiedPlaying",
      current: { key, kind: "ready" },
      queue: [],
    });
  });

  test("failed reprocessing keeps a playable published queue entry", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t, false);
    const roomMediaId = await createRoomMedia(t, roomId, "ready");
    await enqueue(t, roomId, roomMediaId);

    const before = await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId));
    const newJobId = await t.run(
      async (ctx) => await requeueRoomMedia(ctx, { roomId, roomMediaId }),
    );
    await t.mutation(internal.media.jobs.attachWorkflow, {
      jobId: newJobId,
      workflowId: "rebuild" as WorkflowId,
    });
    await t.mutation(internal.media.jobs.failJob, {
      jobId: newJobId,
      workflowId: "rebuild" as WorkflowId,
      errorCode: "MUX_FAILED",
      errorMessage: "mux failed",
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const after = await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId));
    expect(after?.state.queue).toEqual(before?.state.queue);
    expect(after?.state.queue[0]).toMatchObject({ kind: "ready", roomMedia: roomMediaId });
  });

  test("a delayed ready callback uses the selected published asset", async () => {
    const { t, playbackId, roomMediaId, key, published } = await delayedReadySetup();

    await t.mutation(internal.playback.onRoomMediaReady, {
      roomMediaId,
      jobId: published.job,
      assetId: published.asset!,
    });

    const playback = await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId));
    expect(playback?.state).toMatchObject({
      kind: "occupiedPlaying",
      current: { key, kind: "ready", asset: published.asset },
      queue: [],
    });
  });

  test("ready and failed callbacks reject stale revisions", async () => {
    const ready = await delayedReadySetup();
    await makeReady(ready.t, ready.roomMediaId);
    await ready.t.mutation(internal.playback.onRoomMediaReady, {
      roomMediaId: ready.roomMediaId,
      jobId: ready.published.job,
      assetId: ready.published.asset!,
    });
    expect(
      (await ready.t.run(async (ctx) => await ctx.db.get("roomPlayback", ready.playbackId)))?.state,
    ).toMatchObject({ kind: "occupiedWaiting", queue: [{ key: ready.key, kind: "processing" }] });

    const failed = await delayedReadySetup();
    const before = await failed.t.run(
      async (ctx) => await ctx.db.get("roomPlayback", failed.playbackId),
    );
    await failed.t.mutation(internal.playback.onRoomMediaFailed, {
      roomMediaId: failed.roomMediaId,
      jobId: failed.published.job,
      message: "stale failure",
    });
    const after = await failed.t.run(
      async (ctx) => await ctx.db.get("roomPlayback", failed.playbackId),
    );
    expect(after?.state).toEqual(before?.state);
  });

  test("failure promotion updates revision and schedules advancement once", async () => {
    const { t, playbackId, roomMediaId, key, published, jobId } = await delayedReadySetup();
    await t.mutation(internal.media.jobs.failJob, {
      jobId,
      workflowId: "rebuild" as WorkflowId,
      errorCode: "FAIL",
      errorMessage: "failed",
    });
    await t.mutation(internal.playback.onRoomMediaFailed, {
      roomMediaId,
      jobId,
      message: "failed",
    });

    const promoted = await t.run(async (ctx) => await ctx.db.get("roomPlayback", playbackId));
    expect(promoted?.state).toMatchObject({
      kind: "occupiedPlaying",
      current: { key, asset: published.asset },
      queue: [],
    });
    expect(promoted?.revision).toBe(1);
    expect(await advancementJobs(t)).toEqual([
      expect.objectContaining({ roomId: promoted?.room, currentKey: key, expectedRevision: 1 }),
    ]);

    await t.mutation(internal.playback.onRoomMediaFailed, {
      roomMediaId,
      jobId,
      message: "failed",
    });
    expect(await advancementJobs(t)).toHaveLength(1);
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

  test("transposition is shared, survives pause/resume, and preserves scheduled advancement", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t);
    const media = await createRoomMedia(t, roomId, "ready");
    const currentKey = await enqueue(t, roomId, media);
    const before = await t.run((ctx) => ctx.db.get(playbackId));
    const jobs = await advancementJobs(t);
    await t.run((ctx) => transposeRoomPlayback(ctx, { roomId, currentKey, semitones: -3 }));
    const after = await t.run((ctx) => ctx.db.get(playbackId));
    expect(after).toMatchObject({
      revision: before!.revision,
      queueRevision: before!.queueRevision,
      state: { current: { key: currentKey, transposeSemitones: -3 } },
    });
    expect(await advancementJobs(t)).toEqual(jobs);
    await t.run((ctx) => updateRoomTiming(ctx, { roomId, currentKey, update: { velocity: 0 } }));
    await t.run((ctx) => updateRoomTiming(ctx, { roomId, currentKey, update: { velocity: 1 } }));
    expect(await t.run((ctx) => ctx.db.get(playbackId))).toMatchObject({
      state: { current: { transposeSemitones: -3 } },
    });
  });

  test("ignores transposition requests for the previous song and resets on advancement", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t);
    const first = await createRoomMedia(t, roomId, "ready");
    const second = await createRoomMedia(t, roomId, "ready");
    const currentKey = await enqueue(t, roomId, first);
    const nextKey = await enqueue(t, roomId, second);
    await t.run((ctx) => transposeRoomPlayback(ctx, { roomId, currentKey, semitones: 6 }));
    await t.run((ctx) => advanceRoomPlayback(ctx, { roomId, currentKey }));
    const before = await t.run((ctx) => ctx.db.get(playbackId));
    await t.run((ctx) => transposeRoomPlayback(ctx, { roomId, currentKey, semitones: -6 }));
    expect(await t.run((ctx) => ctx.db.get(playbackId))).toEqual(before);
    expect(before?.state).toMatchObject({ current: { key: nextKey } });
    if (before?.state.kind === "occupiedPlaying")
      expect(before.state.current.transposeSemitones ?? 0).toBe(0);
  });

  test.each([-7, 7, 0.5, NaN, Infinity])("rejects invalid transposition %s", async (semitones) => {
    const t = convexTest(schema, modules);
    const { roomId } = await seedRoom(t);
    await expect(
      t.run((ctx) => transposeRoomPlayback(ctx, { roomId, currentKey: "stale", semitones })),
    ).rejects.toThrow("whole number");
  });

  test("enforces playback permissions on the public transposition mutation", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playbackId } = await seedRoom(t);
    const media = await createRoomMedia(t, roomId, "ready");
    const currentKey = await enqueue(t, roomId, media);
    const user = vi.spyOn(authComponent, "getAuthUser");
    user.mockResolvedValue({ _id: "visitor" } as never);
    await expect(
      t.mutation(api.playback.transpose, { roomId, currentKey, semitones: 2 }),
    ).rejects.toThrow("Unauthorized");
    user.mockResolvedValue({ _id: "owner" } as never);
    await t.mutation(api.playback.transpose, { roomId, currentKey, semitones: 2 });
    expect(await t.run((ctx) => ctx.db.get(playbackId))).toMatchObject({
      state: { current: { transposeSemitones: 2 } },
    });
  });
});
