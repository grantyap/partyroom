import { convexTest } from "convex-test";
import type { WorkflowId } from "@convex-dev/workflow";
import { afterEach, describe, expect, test, vi } from "vitest";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { mediaTest, completedArtifacts } from "../../test/media";
import { removeFromRoomImpl } from "./jobs";
import { requeueRoomMedia } from "./domain/jobs";
import { enqueueRoomMedia } from "../playback";
import { defaultRoomMemberPermissions } from "../rooms.schema";

afterEach(() => vi.useRealTimers());

async function seedRoom(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("rooms", {
      owner: "owner",
      name: crypto.randomUUID(),
      memberPermissions: defaultRoomMemberPermissions,
    });
  });
}

async function seedPlaybackRoom(t: ReturnType<typeof mediaTest>) {
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      owner: "owner",
      name: crypto.randomUUID(),
      memberPermissions: defaultRoomMemberPermissions,
    });
    const playbackId = await ctx.db.insert("roomPlayback", {
      room: roomId,
      state: {
        kind: "empty" as const,
        emptySince: Date.now(),
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

async function createSharedPlaybackJob(t: ReturnType<typeof mediaTest>, count = 101) {
  const first = await seedPlaybackRoom(t);
  const requestKey = crypto.randomUUID();
  const workflowId = "shared-workflow" as WorkflowId;
  const owner = await t.mutation(internal.media.jobs.createOrJoin, {
    roomId: first.roomId,
    requestedBy: "user",
    requestKey,
    encryptedSource: "ciphertext",
    sourceIv: "iv",
  });
  await t.mutation(internal.media.jobs.attachWorkflow, {
    jobId: owner.jobId,
    workflowId,
  });
  const associations = [
    { roomId: first.roomId, playbackId: first.playbackId, roomMediaId: owner.roomMediaId },
  ];
  for (let index = 1; index < count; index++) {
    const room = await seedPlaybackRoom(t);
    const joined = await t.mutation(internal.media.jobs.createOrJoin, {
      roomId: room.roomId,
      requestedBy: "user",
      requestKey,
      encryptedSource: "ciphertext",
      sourceIv: "iv",
    });
    associations.push({
      roomId: room.roomId,
      playbackId: room.playbackId,
      roomMediaId: joined.roomMediaId,
    });
  }
  await t.run(async (ctx) => {
    for (const association of associations)
      await enqueueRoomMedia(ctx, {
        roomId: association.roomId,
        roomMediaId: association.roomMediaId,
        addedBy: "user",
      });
  });
  return { jobId: owner.jobId, workflowId, associations };
}

async function queuedItems(
  t: ReturnType<typeof mediaTest>,
  playbackIds: Array<Id<"roomPlayback">>,
) {
  return await t.run(async (ctx) =>
    (
      await Promise.all(playbackIds.map(async (playbackId) => await ctx.db.get(playbackId)))
    ).flatMap((playback) => playback?.state.queue ?? []),
  );
}

async function finishScheduled(t: ReturnType<typeof mediaTest>) {
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

async function createJob(
  t: ReturnType<typeof convexTest>,
  roomId: Id<"rooms">,
  requestKey: string = crypto.randomUUID(),
) {
  const result = await t.mutation(internal.media.jobs.createOrJoin, {
    roomId,
    requestedBy: "user",
    requestKey,
    encryptedSource: "ciphertext",
    sourceIv: "iv",
  });
  if (result.created)
    await t.mutation(internal.media.jobs.attachWorkflow, {
      jobId: result.jobId,
      workflowId: "workflow" as WorkflowId,
    });
  return result;
}

describe("media jobs", () => {
  test("finalization updates every shared playback queue", async () => {
    vi.useFakeTimers();
    const t = mediaTest();
    const { jobId, workflowId, associations } = await createSharedPlaybackJob(t);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId,
      jobId,
      extractor: "youtube",
      sourceId: "shared-finalize",
    });
    const { artifactId } = await completedArtifacts(t, workflowId, ["artifactId"]);
    await t.mutation(internal.media.jobs.recordStageResult, {
      workflowId,
      jobId,
      result: { kind: "mux", artifactId: artifactId! },
    });
    await t.mutation(internal.media.jobs.finalizeAsset, { jobId, workflowId });
    await finishScheduled(t);

    const items = await queuedItems(
      t,
      associations.map((association) => association.playbackId),
    );
    expect(items).toHaveLength(101);
    expect(items.every((item) => item.kind === "ready" && item.asset === claim.assetId)).toBe(true);
  });

  test("cached completion updates every shared playback queue", async () => {
    vi.useFakeTimers();
    const t = mediaTest();
    const { jobId, workflowId, associations } = await createSharedPlaybackJob(t);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId,
      jobId,
      extractor: "youtube",
      sourceId: "shared-complete",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("mediaAssets", claim.assetId, {
        state: "ready",
        finalArtifactId: "ready-artifact",
        activeJob: undefined,
      });
    });
    await t.mutation(internal.media.jobs.completeFromAsset, {
      jobId,
      workflowId,
      assetId: claim.assetId,
    });
    await finishScheduled(t);

    const items = await queuedItems(
      t,
      associations.map((association) => association.playbackId),
    );
    expect(items).toHaveLength(101);
    expect(items.every((item) => item.kind === "ready" && item.asset === claim.assetId)).toBe(true);
  });

  test("failure updates every shared playback queue", async () => {
    vi.useFakeTimers();
    const t = mediaTest();
    const { jobId, workflowId, associations } = await createSharedPlaybackJob(t);
    const message = "shared failure";
    await t.mutation(internal.media.jobs.failJob, {
      jobId,
      workflowId,
      errorCode: "MUX_FAILED",
      errorMessage: message,
    });
    await finishScheduled(t);

    const items = await queuedItems(
      t,
      associations.map((association) => association.playbackId),
    );
    expect(items).toHaveLength(101);
    expect(items.every((item) => item.kind === "failed" && item.message === message)).toBe(true);
  });

  test("reprocessing creates a new run and preserves the published revision", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const { jobId, roomMediaId } = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId,
      extractor: "youtube",
      sourceId: "reprocess",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("mediaAssets", claim.assetId, {
        state: "ready",
        activeJob: undefined,
        finalArtifactId: "stale-output",
      });
      await ctx.db.patch("mediaJobs", jobId, {
        state: "ready",
        asset: claim.assetId,
        workflowId: "completed-workflow",
        errorCode: "OLD_ERROR",
        errorMessage: "Old error",
      });
      await ctx.db.patch("roomMedia", roomMediaId, { asset: claim.assetId });
      await requeueRoomMedia(ctx, { roomId, roomMediaId });
    });

    const result = await t.run(async (ctx) => ({
      job: await ctx.db.get("mediaJobs", jobId),
      association: await ctx.db.get("roomMedia", roomMediaId),
      asset: await ctx.db.get("mediaAssets", claim.assetId),
    }));
    expect(result.job).toMatchObject({ state: "ready", asset: claim.assetId });
    expect(result.association?.job).not.toBe(jobId);
    expect(result.association?.asset).toBe(claim.assetId);
    expect(result.asset?.state).toBe("ready");
    const newJob = await t.run((ctx) => ctx.db.get(result.association!.job));
    expect(newJob).toMatchObject({ state: "queued", rebuild: true });
    expect(newJob?.asset).toBeUndefined();
    await t.mutation(internal.media.jobs.attachWorkflow, {
      jobId: newJob!._id,
      workflowId: "new-workflow" as WorkflowId,
    });
    const fresh = await t.mutation(internal.media.jobs.claimAsset, {
      jobId: newJob!._id,
      workflowId: "new-workflow" as WorkflowId,
      extractor: "youtube",
      sourceId: "reprocess",
    });
    expect(fresh.mode).toBe("owner");
    expect(fresh.assetId).not.toBe(claim.assetId);
    await t.mutation(internal.media.jobs.failJob, {
      jobId,
      workflowId: "completed-workflow" as WorkflowId,
      errorCode: "STALE",
      errorMessage: "late callback",
    });
    expect((await t.run((ctx) => ctx.db.get(newJob!._id)))?.state).toBe("processing");
  });

  test("reprocessing collects an unreferenced failed revision", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const { jobId, roomMediaId } = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId,
      extractor: "youtube",
      sourceId: "failed-revision",
    });
    const outputs = await completedArtifacts(t, "workflow", [
      "instrumentalArtifactId",
      "vocalsArtifactId",
    ]);
    await t.mutation(internal.media.jobs.recordStageResult, {
      workflowId: "workflow" as WorkflowId,
      jobId,
      result: {
        kind: "separate",
        instrumentalArtifactId: outputs.instrumentalArtifactId!,
        vocalsArtifactId: outputs.vocalsArtifactId!,
      },
    });
    await t.mutation(internal.media.jobs.failJob, {
      workflowId: "workflow" as WorkflowId,
      jobId,
      errorCode: "MUX_FAILED",
      errorMessage: "mux failed",
    });

    const newJobId = await t.run(
      async (ctx) => await requeueRoomMedia(ctx, { roomId, roomMediaId }),
    );
    const result = await t.run(async (ctx) => ({
      oldJob: await ctx.db.get("mediaJobs", jobId),
      oldAsset: await ctx.db.get("mediaAssets", claim.assetId),
      newJob: await ctx.db.get("mediaJobs", newJobId),
    }));
    expect(result.oldJob).toBeNull();
    expect(result.oldAsset).toBeNull();
    expect(result.newJob).toMatchObject({ state: "queued", rebuild: true });
    for (const artifactId of Object.values(outputs))
      expect(await t.query(components.activities.artifacts.getUrl, { artifactId })).toBeNull();
  });

  test("collects a shared failed revision after the last room reprocesses", async () => {
    const t = mediaTest();
    const firstRoomId = await seedRoom(t);
    const secondRoomId = await seedRoom(t);
    const first = await createJob(t, firstRoomId, "shared-failed-first");
    const second = await t.mutation(internal.media.jobs.createOrJoin, {
      roomId: secondRoomId,
      requestedBy: "user",
      requestKey: "shared-failed-second",
      encryptedSource: "ciphertext",
      sourceIv: "iv",
    });
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: first.jobId,
      extractor: "youtube",
      sourceId: "shared-failed",
    });
    await t.mutation(internal.media.jobs.attachWorkflow, {
      jobId: second.jobId,
      workflowId: "workflow" as WorkflowId,
    });
    const waiting = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: second.jobId,
      extractor: "youtube",
      sourceId: "shared-failed",
    });
    expect(waiting.mode).toBe("waiting");
    await t.run(async (ctx) => {
      await ctx.db.patch("mediaJobs", second.jobId, {
        state: "failed",
        errorCode: "MUX_FAILED",
        errorMessage: "mux failed",
      });
    });
    const outputs = await completedArtifacts(t, "workflow", [
      "instrumentalArtifactId",
      "vocalsArtifactId",
    ]);
    await t.mutation(internal.media.jobs.recordStageResult, {
      workflowId: "workflow" as WorkflowId,
      jobId: first.jobId,
      result: {
        kind: "separate",
        instrumentalArtifactId: outputs.instrumentalArtifactId!,
        vocalsArtifactId: outputs.vocalsArtifactId!,
      },
    });
    await t.mutation(internal.media.jobs.failJob, {
      workflowId: "workflow" as WorkflowId,
      jobId: first.jobId,
      errorCode: "MUX_FAILED",
      errorMessage: "mux failed",
    });
    const firstRetry = await t.run(
      async (ctx) =>
        await requeueRoomMedia(ctx, { roomId: firstRoomId, roomMediaId: first.roomMediaId }),
    );
    const secondRetry = await t.run(
      async (ctx) =>
        await requeueRoomMedia(ctx, { roomId: secondRoomId, roomMediaId: second.roomMediaId }),
    );
    const result = await t.run(async (ctx) => ({
      firstJob: await ctx.db.get("mediaJobs", first.jobId),
      secondJob: await ctx.db.get("mediaJobs", second.jobId),
      asset: await ctx.db.get("mediaAssets", claim.assetId),
      firstRetry: await ctx.db.get("mediaJobs", firstRetry),
      secondRetry: await ctx.db.get("mediaJobs", secondRetry),
    }));
    expect(result.firstJob).toBeNull();
    expect(result.secondJob).toBeNull();
    expect(result.asset).toBeNull();
    expect(result.firstRetry).toMatchObject({ state: "queued", rebuild: true });
    expect(result.secondRetry).toMatchObject({ state: "queued", rebuild: true });
    for (const artifactId of Object.values(outputs))
      expect(await t.query(components.activities.artifacts.getUrl, { artifactId })).toBeNull();
  });

  test("deletes every room association that directly references a completed asset", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const owner = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: owner.jobId,
      extractor: "youtube",
      sourceId: "direct-room-reference",
    });
    const decoy = await createJob(t, roomId);
    const { artifactId: finalArtifactId } = await completedArtifacts(t, "workflow", ["artifactId"]);
    await t.mutation(components.activities.artifacts.adopt, {
      workflowId: "workflow",
      owner: claim.assetId,
      artifacts: [{ artifactId: finalArtifactId!, slot: "artifactId" }],
    });
    const directAssociation = await t.run(async (ctx) => {
      await ctx.db.patch("mediaAssets", claim.assetId, {
        state: "ready",
        finalArtifactId: finalArtifactId!,
        activeJob: undefined,
        annotationsState: "failed",
      });
      await ctx.db.patch("mediaJobs", owner.jobId, {
        state: "ready",
      });
      return await ctx.db.insert("roomMedia", {
        room: roomId,
        job: decoy.jobId,
        asset: claim.assetId,
        requestedBy: "user",
        createdAt: Date.now(),
      });
    });

    const deleted = await t.mutation(internal.media.jobs.deleteCompletedAsset, {
      assetId: claim.assetId,
    });

    expect(deleted.deletedRoomMedia).toBe(1);
    const remaining = await t.run(async (ctx) => ({
      directAssociation: await ctx.db.get("roomMedia", directAssociation),
      decoyJob: await ctx.db.get("mediaJobs", decoy.jobId),
    }));
    expect(remaining.directAssociation?.asset).toBeUndefined();
    expect(remaining.decoyJob).not.toBeNull();
  });

  test("rejects stage writes from a job that no longer owns the asset", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const first = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: first.jobId,
      extractor: "youtube",
      sourceId: "stale-owner",
    });
    const replacement = await createJob(t, roomId);
    await t.run(async (ctx) => {
      await ctx.db.patch("mediaAssets", claim.assetId, {
        activeJob: replacement.jobId,
      });
    });

    await expect(
      t.mutation(internal.media.jobs.recordStageResult, {
        workflowId: "workflow" as WorkflowId,
        jobId: first.jobId,
        result: { kind: "download", artifactId: "stale-artifact" },
      }),
    ).rejects.toThrow("no longer owns");
  });

  test("lets only the current enrichment workflow write after playback is ready", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const { jobId } = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId,
      extractor: "youtube",
      sourceId: "detached-enrichment-owner",
    });
    const currentWorkflowId = "current-workflow" as WorkflowId;
    const replacementWorkflowId = "replacement-workflow" as WorkflowId;
    const enrichmentId = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch("mediaAssets", claim.assetId, {
        state: "ready",
        finalArtifactId: "missing-final",
        activeJob: undefined,
      });
      return await ctx.db.insert("mediaEnrichments", {
        asset: claim.assetId,
        workflowId: currentWorkflowId,
        state: "processing",
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(internal.media.enrichment.markGeneratedLyricsProcessing, {
      enrichmentId,
      workflowId: currentWorkflowId,
    });
    const published = await completedArtifacts(t, currentWorkflowId, [
      "lyricsArtifactId",
      "timedLyricsArtifactId",
    ]);
    await t.mutation(internal.media.enrichment.recordGeneratedLyrics, {
      enrichmentId,
      workflowId: currentWorkflowId,
      textArtifactId: published.lyricsArtifactId!,
      timedArtifactId: published.timedLyricsArtifactId!,
    });
    await t.run(
      async (ctx) =>
        await ctx.db.patch("mediaEnrichments", enrichmentId, {
          workflowId: replacementWorkflowId,
        }),
    );

    await expect(
      t.mutation(internal.media.enrichment.recordMelody, {
        enrichmentId,
        workflowId: currentWorkflowId,
        artifactId: "stale-melody",
      }),
    ).rejects.toThrow("no longer current");
    const generated = await t.run(async (ctx) => {
      return await ctx.db
        .query("mediaLyricTracks")
        .withIndex("by_asset_and_source", (q) =>
          q.eq("asset", claim.assetId).eq("source", "generated"),
        )
        .unique();
    });
    expect(generated).toMatchObject({
      state: "ready",
      textArtifactId: published.lyricsArtifactId!,
      timedArtifactId: published.timedLyricsArtifactId!,
    });
  });

  test("deletes a completed asset and clears both media cache layers", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const requestKey = "debug-rerun-request";
    const first = await createJob(t, roomId, requestKey);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: first.jobId,
      extractor: "youtube",
      sourceId: "debug-rerun-source",
    });
    const { artifactId: finalArtifactId } = await completedArtifacts(t, "workflow", ["artifactId"]);
    await t.mutation(components.activities.artifacts.adopt, {
      workflowId: "workflow",
      owner: claim.assetId,
      artifacts: [{ artifactId: finalArtifactId!, slot: "artifactId" }],
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("mediaAssets", claim.assetId, {
        state: "ready",
        finalArtifactId: finalArtifactId!,
        activeJob: undefined,
        annotationsState: "failed",
      });
      await ctx.db.patch("mediaJobs", first.jobId, {
        state: "ready",
        asset: claim.assetId,
      });
      await ctx.db.patch("roomMedia", first.roomMediaId, {
        asset: claim.assetId,
      });
    });

    const deleted = await t.mutation(internal.media.jobs.deleteCompletedAsset, {
      assetId: claim.assetId,
    });

    expect(deleted).toEqual({
      deletedJobs: 1,
      deletedRoomMedia: 1,
      deletedStorageObjects: 1,
    });
    const removed = await t.run(async (ctx) => ({
      asset: await ctx.db.get("mediaAssets", claim.assetId),
      job: await ctx.db.get("mediaJobs", first.jobId),
      association: await ctx.db.get("roomMedia", first.roomMediaId),
    }));
    expect(removed).toEqual({
      asset: null,
      job: null,
      association: null,
    });

    const rerun = await createJob(t, roomId, requestKey);
    expect(rerun.created).toBe(true);
    const freshClaim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: rerun.jobId,
      extractor: "youtube",
      sourceId: "debug-rerun-source",
    });
    expect(freshClaim.mode).toBe("owner");
    expect(freshClaim.assetId).not.toBe(claim.assetId);
  });

  test("refuses to delete an unfinished media asset", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const current = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: current.jobId,
      extractor: "youtube",
      sourceId: "still-processing",
    });

    await expect(
      t.mutation(internal.media.jobs.deleteCompletedAsset, {
        assetId: claim.assetId,
      }),
    ).rejects.toThrow("Only successfully completed media assets can be deleted");

    const retained = await t.run(async (ctx) => ({
      asset: await ctx.db.get("mediaAssets", claim.assetId),
      job: await ctx.db.get("mediaJobs", current.jobId),
      association: await ctx.db.get("roomMedia", current.roomMediaId),
    }));
    expect(retained.asset).not.toBeNull();
    expect(retained.job).not.toBeNull();
    expect(retained.association).not.toBeNull();
  });

  test("removes completed room media while retaining its cached asset", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const { jobId, roomMediaId } = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId,
      extractor: "youtube",
      sourceId: "cached-delete",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("mediaAssets", claim.assetId, {
        state: "ready",
        finalArtifactId: "final-artifact",
        activeJob: undefined,
      });
      await ctx.db.patch("mediaJobs", jobId, {
        state: "ready",
        asset: claim.assetId,
      });
      await ctx.db.patch("roomMedia", roomMediaId, { asset: claim.assetId });
    });

    await t.run(async (ctx) => await removeFromRoomImpl(ctx, { roomId, roomMediaId }));

    const result = await t.run(async (ctx) => ({
      association: await ctx.db.get("roomMedia", roomMediaId),
      job: await ctx.db.get("mediaJobs", jobId),
      asset: await ctx.db.get("mediaAssets", claim.assetId),
    }));
    expect(result.association).toBeNull();
    expect(result.job).toBeNull();
    expect(result.asset).not.toBeNull();
  });

  test("removes an unshared in-progress job and its partial asset", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const { jobId, roomMediaId } = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId,
      extractor: "youtube",
      sourceId: "partial-delete",
    });
    await t.run(async (ctx) => await removeFromRoomImpl(ctx, { roomId, roomMediaId }));

    const result = await t.run(async (ctx) => ({
      association: await ctx.db.get("roomMedia", roomMediaId),
      job: await ctx.db.get("mediaJobs", jobId),
      asset: await ctx.db.get("mediaAssets", claim.assetId),
    }));
    expect(result).toEqual({
      association: null,
      job: null,
      asset: null,
    });
  });

  test("keeps a processing job that is still attached to another room", async () => {
    const t = mediaTest();
    const firstRoom = await seedRoom(t);
    const secondRoom = await seedRoom(t);
    const first = await createJob(t, firstRoom, "shared-room-delete");
    const second = await createJob(t, secondRoom, "shared-room-delete");

    await t.run(
      async (ctx) =>
        await removeFromRoomImpl(ctx, {
          roomId: firstRoom,
          roomMediaId: first.roomMediaId,
        }),
    );

    const result = await t.run(async (ctx) => ({
      firstAssociation: await ctx.db.get("roomMedia", first.roomMediaId),
      secondAssociation: await ctx.db.get("roomMedia", second.roomMediaId),
      job: await ctx.db.get("mediaJobs", first.jobId),
    }));
    expect(result.firstAssociation).toBeNull();
    expect(result.secondAssociation).not.toBeNull();
    expect(result.job).not.toBeNull();
  });

  test("joins an active job for an identical request", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const first = await createJob(t, roomId, "same-request");
    const second = await createJob(t, roomId, "same-request");

    expect(first.created).toBe(true);
    expect(second).toMatchObject({
      created: false,
      jobId: first.jobId,
      roomMediaId: first.roomMediaId,
    });
    const rows = await t.run(async (ctx) => await ctx.db.query("roomMedia").collect());
    expect(rows).toHaveLength(1);
  });

  test("finds an active request beyond terminal job history", async () => {
    const t = mediaTest();
    const ownerRoomId = await seedRoom(t);
    const requestKey = "history-request";
    const first = await createJob(t, ownerRoomId, requestKey);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: first.jobId,
      extractor: "youtube",
      sourceId: "history-request",
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch("mediaAssets", claim.assetId, {
        state: "ready",
        activeJob: undefined,
        finalArtifactId: "ready-output",
      });
      await ctx.db.patch("mediaJobs", first.jobId, { state: "ready" });
      for (let index = 0; index < 100; index++)
        await ctx.db.insert("mediaJobs", {
          requestKey,
          encryptedSource: `failed-${index}`,
          sourceIv: "iv",
          requestedBy: "user",
          state: "failed",
          errorCode: "FAILED",
          errorMessage: "failed",
          createdAt: now,
          updatedAt: now,
        });
    });

    const roomId = await seedRoom(t);
    const joined = await t.mutation(internal.media.jobs.createOrJoin, {
      roomId,
      requestedBy: "user",
      requestKey,
      encryptedSource: "ciphertext",
      sourceIv: "iv",
    });
    expect(joined).toMatchObject({ created: false, jobId: first.jobId });
  });

  test("finds a cached asset beyond failed revision history", async () => {
    const t = mediaTest();
    const ownerRoomId = await seedRoom(t);
    const first = await createJob(t, ownerRoomId, "cache-history-owner");
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: first.jobId,
      extractor: "youtube",
      sourceId: "cache-history",
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch("mediaAssets", claim.assetId, {
        state: "ready",
        activeJob: undefined,
        finalArtifactId: "ready-output",
      });
      await ctx.db.patch("mediaJobs", first.jobId, { state: "ready" });
      for (let index = 0; index < 100; index++)
        await ctx.db.insert("mediaAssets", {
          cacheKey: `v5:youtube:cache-history`,
          extractor: "youtube",
          sourceId: `failed-${index}`,
          state: "failed",
          createdAt: now,
          updatedAt: now,
        });
    });

    const second = await createJob(t, ownerRoomId, "cache-history-new");
    const cached = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: second.jobId,
      extractor: "youtube",
      sourceId: "cache-history",
    });
    expect(cached).toEqual({ mode: "cached", assetId: claim.assetId });
  });

  test("deduplicates different request URLs after resolving extractor identity", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const first = await createJob(t, roomId, "signed-url-one");
    const second = await createJob(t, roomId, "signed-url-two");

    const owner = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: first.jobId,
      extractor: "Youtube",
      sourceId: "abc123",
      title: "Song",
      duration: 120,
    });
    const waiter = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: second.jobId,
      extractor: "youtube",
      sourceId: "abc123",
      title: "Song",
      duration: 120,
    });

    expect(owner.mode).toBe("owner");
    expect(waiter).toMatchObject({ mode: "waiting", assetId: owner.assetId });
  });

  test("publishes stems atomically and rejects unregistered output IDs", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const { jobId } = await createJob(t, roomId);
    const workflowId = "workflow" as WorkflowId;
    const { assetId } = await t.mutation(internal.media.jobs.claimAsset, {
      jobId,
      workflowId,
      extractor: "youtube",
      sourceId: "stems",
    });
    await expect(
      t.mutation(internal.media.jobs.recordStageResult, {
        jobId,
        workflowId,
        result: {
          kind: "separate",
          instrumentalArtifactId: "invented",
          vocalsArtifactId: "invented",
        },
      }),
    ).rejects.toThrow();
    const outputs = await completedArtifacts(t, workflowId, [
      "instrumentalArtifactId",
      "vocalsArtifactId",
    ]);
    await t.mutation(internal.media.jobs.recordStageResult, {
      jobId,
      workflowId,
      result: {
        kind: "separate",
        instrumentalArtifactId: outputs.instrumentalArtifactId!,
        vocalsArtifactId: outputs.vocalsArtifactId!,
      },
    });
    expect(await t.run((ctx) => ctx.db.get(assetId))).toMatchObject(outputs);
  });

  test("marks playback ready while durable enrichment is still processing", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const { jobId } = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId,
      extractor: "youtube",
      sourceId: "durable-enrichment",
    });
    const { artifactId: finalVideo } = await completedArtifacts(t, "workflow", ["artifactId"]);
    await t.mutation(internal.media.jobs.recordStageResult, {
      workflowId: "workflow" as WorkflowId,
      jobId,
      result: { kind: "mux", artifactId: finalVideo! },
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("mediaEnrichments", {
        asset: claim.assetId,
        workflowId: "detached-workflow",
        state: "processing",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("mediaLyricTracks", {
        asset: claim.assetId,
        source: "generated",
        label: "Generated",
        timing: "word",
        state: "processing",
        createdAt: now,
        updatedAt: now,
      });
    });
    await t.mutation(internal.media.jobs.finalizeAsset, {
      jobId,
      workflowId: "workflow" as WorkflowId,
    });

    const result = await t.run(async (ctx) => {
      const job = await ctx.db.get("mediaJobs", jobId);
      return {
        job,
        asset: job?.asset ? await ctx.db.get("mediaAssets", job.asset) : null,
        enrichment: await ctx.db
          .query("mediaEnrichments")
          .withIndex("by_asset", (q) => q.eq("asset", claim.assetId))
          .unique(),
      };
    });
    expect(result.asset).toMatchObject({
      state: "ready",
      finalArtifactId: finalVideo,
      annotationsState: "processing",
    });
    expect(result.asset?.activeJob).toBeUndefined();
    expect(result.enrichment?.state).toBe("processing");
  });

  test("reuses a cache entry as soon as playback is ready", async () => {
    const t = mediaTest();
    const roomId = await seedRoom(t);
    const first = await createJob(t, roomId, "cache-owner");
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: first.jobId,
      extractor: "youtube",
      sourceId: "complete-cache-entry",
    });
    expect(claim.mode).toBe("owner");
    const { artifactId: finalVideo } = await completedArtifacts(t, "workflow", ["artifactId"]);
    await t.mutation(internal.media.jobs.recordStageResult, {
      workflowId: "workflow" as WorkflowId,
      jobId: first.jobId,
      result: { kind: "mux", artifactId: finalVideo! },
    });
    await t.mutation(internal.media.jobs.finalizeAsset, {
      jobId: first.jobId,
      workflowId: "workflow" as WorkflowId,
    });

    const second = await createJob(t, roomId, "another-signed-url");
    const cached = await t.mutation(internal.media.jobs.claimAsset, {
      workflowId: "workflow" as WorkflowId,
      jobId: second.jobId,
      extractor: "youtube",
      sourceId: "complete-cache-entry",
    });
    expect(cached).toMatchObject({ mode: "cached", assetId: claim.assetId });
  });
});
