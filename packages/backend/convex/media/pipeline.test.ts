import { afterEach, expect, test, vi } from "vitest";
import { mediaActivities } from "@partyroom/media-activities";
import { components, internal } from "../_generated/api";
import { managedWorkflow, workflowStatus } from "../activities/workflowManager";
import { attachWorkflowToJob } from "./domain/jobs";
import { defaultRoomMemberPermissions } from "../rooms.schema";
import { completedArtifacts, workflowTest } from "../../test/media";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test.each([
  ["cached", "mediaPipeline"],
  ["waiting", "mediaPipeline"],
  ["cached", "mediaPipelineV2"],
  ["waiting", "mediaPipelineV2"],
  ["cached", "mediaPipelineV3"],
  ["waiting", "mediaPipelineV3"],
] as const)(
  "replays the journal, completes a %s run on %s, and settles its scope",
  async (mode, pipeline) => {
    vi.useFakeTimers();
    const t = await workflowTest();
    const roomId = await t.run((ctx) =>
      ctx.db.insert("rooms", {
        owner: "owner",
        name: "room",
        memberPermissions: defaultRoomMemberPermissions,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("roomPlayback", {
        room: roomId,
        state: {
          kind: "empty",
          emptySince: Date.now(),
          occupancyGeneration: 0,
          transport: { kind: "idle" },
          queue: [],
        },
        revision: 0,
        queueRevision: 0,
      }),
    );
    const { artifactId } = await completedArtifacts(t, "publisher", ["artifactId"]);
    const owner = await t.mutation(internal.media.jobs.createOrJoin, {
      roomId,
      requestedBy: "user",
      requestKey: "owner",
      encryptedSource: "encrypted",
      sourceIv: "iv",
    });
    await t.mutation(internal.media.jobs.attachWorkflow, {
      jobId: owner.jobId,
      workflowId: "publisher" as any,
    });
    const { assetId } = await t.mutation(internal.media.jobs.claimAsset, {
      jobId: owner.jobId,
      workflowId: "publisher" as any,
      extractor: "youtube",
      sourceId: "cached",
    });
    await t.mutation(internal.media.jobs.recordStageResult, {
      jobId: owner.jobId,
      workflowId: "publisher" as any,
      result: { kind: "mux", artifactId: artifactId! },
    });
    if (mode === "cached")
      await t.mutation(internal.media.jobs.finalizeAsset, {
        jobId: owner.jobId,
        workflowId: "publisher" as any,
      });
    const { jobId, roomMediaId } = await t.mutation(internal.media.jobs.createOrJoin, {
      roomId,
      requestedBy: "user",
      requestKey: "cache-hit",
      encryptedSource: "encrypted",
      sourceIv: "iv",
    });
    const workflowId = await t.run(async (ctx) => {
      const id = await managedWorkflow.start(
        ctx,
        internal.media.pipeline[pipeline],
        { jobId },
        { onComplete: internal.media.pipeline.onPipelineComplete, context: { jobId } },
      );
      await attachWorkflowToJob(ctx, jobId, id);
      return id;
    });
    await t.query(components.activities.workflowSteps.list, { workflowId });
    await t.query(internal.media.activityInputs.core.resolve, { jobId, workflowId });
    const tick = async () => {
      vi.advanceTimersByTime(100);
      await t.finishInProgressScheduledFunctions();
    };
    let lease = null;
    for (let i = 0; i < 30 && !lease; i++) {
      await tick();
      lease = await t.mutation(components.activities.activities.claim, {
        protocolVersion: 2,
        taskQueue: mediaActivities.resolve.queue.name,
        workerId: "resolver",
        supportedActivities: [
          { name: mediaActivities.resolve.name, version: mediaActivities.resolve.version },
        ],
      });
    }
    expect(lease).not.toBeNull();
    expect(
      await t.query(internal.media.jobs.getEncryptedSource, { attemptToken: lease!.attemptToken }),
    ).toEqual({ encryptedSource: "encrypted", sourceIv: "iv" });
    expect(await t.run((ctx) => managedWorkflow.getProgress(ctx, workflowId))).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "resolve", state: "running" })]),
    );
    await t.mutation(components.activities.activities.complete, {
      attemptToken: lease!.attemptToken,
      value: { extractor: "youtube", sourceId: "cached" },
    });
    await expect(
      t.query(internal.media.jobs.getEncryptedSource, { attemptToken: lease!.attemptToken }),
    ).rejects.toThrow("lease");
    if (mode === "waiting") {
      for (let i = 0; i < 10; i++) await tick();
      expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
        state: "processing",
        asset: assetId,
      });
      await t.mutation(internal.media.jobs.finalizeAsset, {
        jobId: owner.jobId,
        workflowId: "publisher" as any,
      });
      expect((await t.run((ctx) => ctx.db.get(jobId)))?.state).toBe("processing");
    }
    for (let i = 0; i < 30; i++) {
      await tick();
      if ((await t.run((ctx) => workflowStatus(ctx, workflowId))).type === "completed") break;
    }
    expect(await t.run((ctx) => workflowStatus(ctx, workflowId))).toMatchObject({
      type: "completed",
    });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      state: "ready",
      asset: assetId,
    });
    expect(await t.run((ctx) => ctx.db.get(roomMediaId))).toMatchObject({ asset: assetId });
    const steps = await t.run((ctx) => managedWorkflow.getProgress(ctx, workflowId));
    expect(steps.find((step) => step.key === "resolve")).toMatchObject({
      state: "completed",
      attempt: 1,
    });
    expect(steps.find((step) => step.key === "download")).toMatchObject({ state: "skipped" });
    expect(steps.find((step) => step.key === "extractMetadata")).toEqual(
      pipeline === "mediaPipelineV3" ? expect.objectContaining({ state: "skipped" }) : undefined,
    );
    for (let i = 0; i < 10; i++) await tick();
    const scopeId = await t.query(components.activities.artifacts.getScopeForWorkflow, {
      workflowId,
    });
    await expect(
      t.mutation(components.activities.activities.schedule, {
        activityType: "test",
        activityVersion: 1,
        taskQueue: "test",
        queue: { leaseDurationMs: 1000 },
        input: {},
        inputSchema: { kind: "object", fields: {} },
        outputSchema: { kind: "object", fields: {} },
        artifactScopeId: scopeId!,
        retryPolicy: {
          maximumAttempts: 1,
          initialIntervalMs: 1,
          maximumIntervalMs: 1,
          backoffCoefficient: 1,
          nonRetryableErrorTypes: [],
        },
        startToCloseTimeoutMs: 1000,
        scheduleToCloseTimeoutMs: 1000,
      }),
    ).rejects.toThrow("scope");
  },
);

// Runs the actual workflow journal, workpool, and activity component; only LRCLIB HTTP is mocked.
async function fallbackPipeline(routingVersion: 1 | 2 = 2) {
  vi.useFakeTimers();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const http = vi.fn<typeof fetch>().mockImplementation(async () => Response.json([]));
  vi.stubGlobal("fetch", http);
  const t = await workflowTest();
  const roomId = await t.run(async (ctx) => {
    await ctx.db.insert("migrationRuns", {
      migrationId: "workflow-state-redesign-v1",
      phase: "complete",
      routingVersion,
      updatedAt: Date.now(),
    });
    const room = await ctx.db.insert("rooms", {
      owner: "owner",
      name: "room",
      memberPermissions: defaultRoomMemberPermissions,
    });
    await ctx.db.insert("roomPlayback", {
      room,
      state: {
        kind: "empty",
        emptySince: Date.now(),
        occupancyGeneration: 0,
        transport: { kind: "idle" },
        queue: [],
      },
      revision: 0,
      queueRevision: 0,
    });
    return room;
  });
  const { jobId } = await t.mutation(internal.media.jobs.request, {
    roomId,
    requestedBy: "user",
    requestKey: "fallback",
    encryptedSource: "encrypted",
    sourceIv: "iv",
  });
  const workflowId = (await t.run((ctx) => ctx.db.get(jobId)))!.workflowId!;
  const tick = async (ms = 100) => {
    vi.advanceTimersByTime(ms);
    await t.finishInProgressScheduledFunctions();
  };
  const claim = async (
    definition:
      | typeof mediaActivities.resolve
      | typeof mediaActivities.extractMetadata
      | typeof mediaActivities.download,
  ) =>
    t.mutation(components.activities.activities.claim, {
      protocolVersion: 2,
      taskQueue: definition.queue.name,
      workerId: "test-worker",
      supportedActivities: [{ name: definition.name, version: definition.version }],
    });
  const untilClaim = async (definition: Parameters<typeof claim>[0]) => {
    for (let i = 0; i < 150; i++) {
      await tick();
      const lease = await claim(definition);
      if (lease) return lease;
    }
    throw new Error(`No ${definition.name} activity`);
  };
  const resolve = await untilClaim(mediaActivities.resolve);
  const finishResolve = async (metadata = {}) => {
    await t.mutation(components.activities.activities.complete, {
      attemptToken: resolve.attemptToken,
      value: {
        extractor: "youtube",
        sourceId: "new-source",
        title: "Unhelpful upload",
        duration: 131,
        ...metadata,
      },
    });
  };
  const progress = () => t.run((ctx) => managedWorkflow.getProgress(ctx, workflowId as any));
  const lyrics = () =>
    t.run(async (ctx) => {
      const job = await ctx.db.get(jobId);
      return await ctx.db
        .query("mediaLyricTracks")
        .withIndex("by_asset_and_source", (q) => q.eq("asset", job!.asset!).eq("source", "lrclib"))
        .unique();
    });
  return { t, http, jobId, workflowId, tick, claim, untilClaim, finishResolve, progress, lyrics };
}

const extractedMetadata = { trackName: "Example Song", artistName: "Example Artist" };
const syncedRecord = {
  id: 1,
  ...extractedMetadata,
  albumName: "Album",
  duration: 131,
  instrumental: false,
  syncedLyrics: "[00:01.00] Example",
};

test("new v2 starts route to V3 and durably extract only after a real miss", async () => {
  const f = await fallbackPipeline();
  await f.finishResolve();
  const extraction = await f.untilClaim(mediaActivities.extractMetadata);
  expect(extraction.input).toEqual({ title: "Unhelpful upload" });
  expect(f.http).toHaveBeenCalledTimes(1);
  expect(await f.progress()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "fetchLyrics", state: "completed" }),
      expect.objectContaining({ key: "extractMetadata", state: "running" }),
    ]),
  );
  // Several engine resumptions do not repeat the completed initial action.
  for (let i = 0; i < 5; i++) await f.tick();
  expect(f.http).toHaveBeenCalledTimes(1);
  f.http.mockImplementation(async () => Response.json([syncedRecord]));
  await f.t.mutation(components.activities.activities.complete, {
    attemptToken: extraction.attemptToken,
    value: extractedMetadata,
  });
  await f.untilClaim(mediaActivities.download);
  expect(await f.lyrics()).toMatchObject({ state: "ready", metadata: { providerId: "1" } });
  expect(f.http).toHaveBeenCalledTimes(2);
  expect(String(f.http.mock.calls[1][0])).toContain("track_name=Example+Song");
});

test.each(["success", "http", "network"])("does not extract on original %s", async (mode) => {
  const f = await fallbackPipeline();
  if (mode === "success") f.http.mockImplementation(async () => Response.json([syncedRecord]));
  else if (mode === "http")
    f.http.mockImplementation(async () => Response.json({}, { status: 503 }));
  else f.http.mockRejectedValue(new Error("network unavailable"));
  await f.finishResolve({
    track: extractedMetadata.trackName,
    artist: extractedMetadata.artistName,
  });
  await f.untilClaim(mediaActivities.download);
  expect(await f.claim(mediaActivities.extractMetadata)).toBeNull();
  expect((await f.progress()).find((s) => s.key === "extractMetadata")?.state).toBe("pending");
  expect(await f.lyrics()).toMatchObject({ state: mode === "success" ? "ready" : "failed" });
});

test.each([
  "unknown",
  "failed",
  "canceled",
  "deadline",
  "attempt-timeout",
  "retryable",
  "fallback-http",
])("optional extraction %s is bounded and core download continues", async (mode) => {
  const f = await fallbackPipeline();
  await f.finishResolve();
  if (mode === "deadline") {
    // No worker claims the metadata queue: queue wait itself must expire.
    for (let i = 0; i < 50; i++) {
      await f.tick();
      if ((await f.progress()).some((s) => s.key === "extractMetadata" && s.state === "running"))
        break;
    }
    await f.tick(60_000);
  } else {
    const extraction = await f.untilClaim(mediaActivities.extractMetadata);
    if (mode === "failed") {
      await f.t.mutation(components.activities.activities.fail, {
        attemptToken: extraction.attemptToken,
        errorType: "ModelFailure",
        errorMessage: "model unavailable",
        nonRetryable: true,
      });
    } else if (mode === "retryable") {
      expect(extraction.attemptDeadline - Date.now()).toBeLessThanOrEqual(30_000);
      expect(extraction.scheduleDeadline - Date.now()).toBeLessThanOrEqual(60_000);
      for (let attempt = 1; attempt <= 3; attempt++) {
        const lease =
          attempt === 1 ? extraction : await f.untilClaim(mediaActivities.extractMetadata);
        await f.t.mutation(components.activities.activities.fail, {
          attemptToken: lease.attemptToken,
          errorType: "ModelUnavailable",
          errorMessage: "retry later",
        });
      }
    } else if (mode === "canceled") {
      await f.t.mutation(components.activities.activities.requestCancel, {
        activityId: extraction.activityId,
      });
      await f.t.mutation(components.activities.activities.acknowledgeCancellation, {
        attemptToken: extraction.attemptToken,
      });
    } else if (mode === "attempt-timeout") {
      await f.tick(30_000);
      await f.tick(30_000);
    } else {
      if (mode === "fallback-http")
        f.http.mockImplementation(async () => Response.json({}, { status: 503 }));
      await f.t.mutation(components.activities.activities.complete, {
        attemptToken: extraction.attemptToken,
        value: mode === "unknown" ? {} : extractedMetadata,
      });
    }
  }
  await f.untilClaim(mediaActivities.download);
  expect(await f.lyrics()).toMatchObject({ state: "not_found" });
  expect(f.http).toHaveBeenCalledTimes(mode === "fallback-http" ? 2 : 1);
  expect((await f.t.run((ctx) => ctx.db.get(f.jobId)))?.state).toBe("processing");
});

test("v1 routing keeps the legacy graph on an ordinary miss", async () => {
  const f = await fallbackPipeline(1);
  await f.finishResolve();
  await f.untilClaim(mediaActivities.download);
  expect(await f.claim(mediaActivities.extractMetadata)).toBeNull();
  expect((await f.progress()).some((s) => s.key === "extractMetadata")).toBe(false);
  expect(await f.lyrics()).toMatchObject({ state: "not_found" });
});
