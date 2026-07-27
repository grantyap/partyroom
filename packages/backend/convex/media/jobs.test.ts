import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { modules } from "../test.setup";
import { removeFromRoomImpl } from "./jobs";
import { recordActivityTerminal, requeueRoomMedia } from "./service";

async function seedRoom(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("rooms", { owner: "owner", name: crypto.randomUUID() });
  });
}

async function createJob(
  t: ReturnType<typeof convexTest>,
  roomId: Id<"rooms">,
  requestKey: string = crypto.randomUUID(),
) {
  return await t.mutation(internal.media.jobs.createOrJoin, {
    roomId,
    requestedBy: "user",
    requestKey,
    encryptedSource: "ciphertext",
    sourceIv: "iv",
  });
}

describe("media jobs", () => {
  test("removes only the terminal activity from the job projection", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const { jobId } = await createJob(t, roomId);
    await t.run(async (ctx) => {
      await ctx.db.patch("mediaJobs", jobId, {
        activeActivities: [
          { activityId: "finished", kind: "download" },
          { activityId: "running", kind: "transcribe" },
        ],
      });
      await recordActivityTerminal(ctx, jobId, "finished", {
        startedAt: 10_000,
        completedAt: 75_000,
      });
    });

    const job = await t.run(async (ctx) => await ctx.db.get("mediaJobs", jobId));
    expect(job?.activeActivities).toEqual([{ activityId: "running", kind: "transcribe" }]);
    expect(job?.stepTimings).toEqual([
      { kind: "download", startedAt: 10_000, completedAt: 75_000 },
    ]);
  });

  test("requeues terminal media and clears stale output references", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const { jobId, roomMediaId } = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
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
        stage: "ready",
        progress: 1,
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
    expect(result.job).toMatchObject({
      state: "queued",
      stage: "queued",
      progress: 0,
      activeActivities: [],
    });
    expect(result.job?.asset).toBeUndefined();
    expect(result.job?.workflowId).toBeUndefined();
    expect(result.job?.errorCode).toBeUndefined();
    expect(result.job?.errorMessage).toBeUndefined();
    expect(result.association?.asset).toBeUndefined();
    expect(result.asset?.state).toBe("failed");
  });

  test("deletes every room association that directly references a completed asset", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const owner = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      jobId: owner.jobId,
      extractor: "youtube",
      sourceId: "direct-room-reference",
    });
    const decoy = await createJob(t, roomId);
    const directAssociation = await t.run(async (ctx) => {
      await ctx.db.patch("mediaAssets", claim.assetId, {
        state: "ready",
        activeJob: undefined,
        annotationsState: "failed",
      });
      await ctx.db.patch("mediaJobs", owner.jobId, {
        state: "ready",
        stage: "ready",
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
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const first = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
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
        jobId: first.jobId,
        kind: "download",
        artifactId: "stale-artifact",
      }),
    ).rejects.toThrow("no longer owns");
  });

  test("deletes a completed asset and clears both media cache layers", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const requestKey = "debug-rerun-request";
    const first = await createJob(t, roomId, requestKey);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      jobId: first.jobId,
      extractor: "youtube",
      sourceId: "debug-rerun-source",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("mediaAssets", claim.assetId, {
        state: "ready",
        activeJob: undefined,
        annotationsState: "failed",
      });
      await ctx.db.patch("mediaJobs", first.jobId, {
        state: "ready",
        stage: "ready",
        progress: 1,
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
      deletedStorageObjects: 0,
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
      jobId: rerun.jobId,
      extractor: "youtube",
      sourceId: "debug-rerun-source",
    });
    expect(freshClaim.mode).toBe("owner");
    expect(freshClaim.assetId).not.toBe(claim.assetId);
  });

  test("refuses to delete an unfinished media asset", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const current = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
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
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const { jobId, roomMediaId } = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      jobId,
      extractor: "youtube",
      sourceId: "cached-delete",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("mediaAssets", claim.assetId, {
        state: "ready",
        finalArtifactId: "final-artifact",
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
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const { jobId, roomMediaId } = await createJob(t, roomId);
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
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
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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

  test("deduplicates different request URLs after resolving extractor identity", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const first = await createJob(t, roomId, "signed-url-one");
    const second = await createJob(t, roomId, "signed-url-two");

    const owner = await t.mutation(internal.media.jobs.claimAsset, {
      jobId: first.jobId,
      extractor: "Youtube",
      sourceId: "abc123",
      title: "Song",
      duration: 120,
    });
    const waiter = await t.mutation(internal.media.jobs.claimAsset, {
      jobId: second.jobId,
      extractor: "youtube",
      sourceId: "abc123",
      title: "Song",
      duration: 120,
    });

    expect(owner.mode).toBe("owner");
    expect(waiter).toMatchObject({ mode: "waiting", assetId: owner.assetId });
  });

  test("records stems, structured lyrics, and annotation exports", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const { jobId } = await createJob(t, roomId);
    await t.mutation(internal.media.jobs.claimAsset, {
      jobId,
      extractor: "youtube",
      sourceId: "stems-and-lyrics",
    });
    const [instrumental, vocals, lyrics, timedLyrics, melody, annotations, midi, musicXml] =
      await t.run(async (ctx) =>
        Promise.all([
          ctx.storage.store(new Blob(["instrumental"])),
          ctx.storage.store(new Blob(["vocals"])),
          ctx.storage.store(new Blob(["WEBVTT"])),
          ctx.storage.store(new Blob(["timed lyrics"])),
          ctx.storage.store(new Blob(["melody"])),
          ctx.storage.store(new Blob(["JAMS"])),
          ctx.storage.store(new Blob(["MIDI"])),
          ctx.storage.store(new Blob(["MusicXML"])),
        ]),
      );

    await t.mutation(internal.media.jobs.recordStageResult, {
      jobId,
      kind: "separate",
      artifactId: instrumental,
      secondaryArtifactId: vocals,
    });
    await t.mutation(internal.media.jobs.recordLyricTrack, {
      jobId,
      source: "generated",
      label: "Generated",
      timing: "word",
      state: "ready",
      textArtifactId: lyrics,
      timedArtifactId: timedLyrics,
    });
    await t.mutation(internal.media.jobs.recordStageResult, {
      jobId,
      kind: "analyzeMelody",
      artifactId: melody,
    });
    await t.mutation(internal.media.jobs.recordStageResult, {
      jobId,
      kind: "assembleAnnotations",
      artifactId: annotations,
      secondaryArtifactId: midi,
      tertiaryArtifactId: musicXml,
    });

    const { asset, generatedLyrics } = await t.run(async (ctx) => {
      const job = await ctx.db.get("mediaJobs", jobId);
      const asset = job?.asset ? await ctx.db.get("mediaAssets", job.asset) : null;
      const generatedLyrics = asset
        ? await ctx.db
            .query("mediaLyricTracks")
            .withIndex("by_asset_and_source", (q) =>
              q.eq("asset", asset._id).eq("source", "generated"),
            )
            .unique()
        : null;
      return { asset, generatedLyrics };
    });
    expect(asset).toMatchObject({
      instrumentalArtifactId: instrumental,
      vocalsArtifactId: vocals,
      melodyArtifactId: melody,
      annotationsArtifactId: annotations,
      midiArtifactId: midi,
      musicXmlArtifactId: musicXml,
      annotationsState: "ready",
    });
    expect(generatedLyrics).toMatchObject({
      source: "generated",
      textArtifactId: lyrics,
      timedArtifactId: timedLyrics,
      timing: "word",
      state: "ready",
    });
  });

  test("keeps instrumental playback available when annotations fail", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const { jobId } = await createJob(t, roomId);
    await t.mutation(internal.media.jobs.claimAsset, {
      jobId,
      extractor: "youtube",
      sourceId: "optional-annotations",
    });

    await t.mutation(internal.media.jobs.markAnnotationsFailed, {
      jobId,
      errorMessage: "model unavailable",
    });

    const asset = await t.run(async (ctx) => {
      const job = await ctx.db.get("mediaJobs", jobId);
      return job?.asset ? await ctx.db.get("mediaAssets", job.asset) : null;
    });
    expect(asset).toMatchObject({
      state: "processing",
      annotationsState: "failed",
      annotationsError: "model unavailable",
    });
  });

  test("only reuses a cache entry after playback, lyrics, and annotations are terminal", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const first = await createJob(t, roomId, "cache-owner");
    const claim = await t.mutation(internal.media.jobs.claimAsset, {
      jobId: first.jobId,
      extractor: "youtube",
      sourceId: "complete-cache-entry",
    });
    expect(claim.mode).toBe("owner");
    const [lyrics, finalVideo] = await t.run(async (ctx) =>
      Promise.all([
        ctx.storage.store(new Blob(["WEBVTT"])),
        ctx.storage.store(new Blob(["video"])),
      ]),
    );
    await t.mutation(internal.media.jobs.recordLyricTrack, {
      jobId: first.jobId,
      source: "generated",
      label: "Generated",
      timing: "word",
      state: "ready",
      textArtifactId: lyrics,
    });
    await t.mutation(internal.media.jobs.recordStageResult, {
      jobId: first.jobId,
      kind: "mux",
      artifactId: finalVideo,
    });
    await t.mutation(internal.media.jobs.markAnnotationsFailed, {
      jobId: first.jobId,
      errorMessage: "optional model failure",
    });
    await t.mutation(internal.media.jobs.finalizeAsset, { jobId: first.jobId });

    const second = await createJob(t, roomId, "another-signed-url");
    const cached = await t.mutation(internal.media.jobs.claimAsset, {
      jobId: second.jobId,
      extractor: "youtube",
      sourceId: "complete-cache-entry",
    });
    expect(cached).toMatchObject({ mode: "cached", assetId: claim.assetId });
  });
});
