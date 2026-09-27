import { afterEach, expect, test, vi } from "vitest";
import { mediaActivities } from "@partyroom/media-activities";
import { components, internal } from "../_generated/api";
import { managedWorkflow, workflowStatus } from "../activities/workflowManager";
import { attachWorkflowToJob } from "./domain/jobs";
import { defaultRoomMemberPermissions } from "../rooms.schema";
import { completedArtifacts, workflowTest } from "../../test/media";

afterEach(() => vi.useRealTimers());

test.each(["cached", "waiting"] as const)(
  "replays the journal, completes a %s run, and settles its scope",
  async (mode) => {
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
        internal.media.pipeline.mediaPipeline,
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
