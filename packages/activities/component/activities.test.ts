/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { protocolVersion } from "./validators";

const modules = import.meta.glob("./**/*.{ts,js}");

function scheduleArgs(overrides: Record<string, unknown> = {}) {
  return {
    activityType: "media.separate",
    activityVersion: 1,
    taskQueue: "stems",
    queue: { leaseDurationMs: 10_000, maxConcurrentActivities: 1 },
    input: { audioStorageId: "storage-id" },
    retryPolicy: {
      maximumAttempts: 3,
      initialIntervalMs: 1_000,
      backoffCoefficient: 2,
      maximumIntervalMs: 30_000,
      nonRetryableErrorTypes: ["UnsupportedMedia"],
    },
    startToCloseTimeoutMs: 60_000,
    scheduleToCloseTimeoutMs: 300_000,
    ...overrides,
  };
}

async function claim(t: ReturnType<typeof convexTest>, workerId = "worker-1") {
  return await t.mutation(api.activities.claim, {
    protocolVersion,
    taskQueue: "stems",
    workerId,
    supportedActivities: [{ name: "media.separate", version: 1 }],
  });
}

describe("activities component", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("rejects claims from an incompatible worker protocol", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.activities.claim, {
        protocolVersion: 2,
        taskQueue: "stems",
        workerId: "old-worker",
        supportedActivities: [{ name: "media.separate", version: 1 }],
      } as never),
    ).rejects.toThrow();
  });

  test("claims compatible work once and respects queue concurrency", async () => {
    const t = convexTest(schema, modules);
    const firstId = await t.mutation(api.activities.schedule, scheduleArgs());
    await t.mutation(
      api.activities.schedule,
      scheduleArgs({ input: { audioStorageId: "second" } }),
    );

    const first = await claim(t);
    expect(first).toMatchObject({
      activityId: firstId,
      activityType: "media.separate",
      activityVersion: 1,
      attempt: 1,
      input: { audioStorageId: "storage-id" },
    });
    const repeated = await claim(t);
    expect(repeated).toEqual(first);
    expect(await claim(t, "worker-2")).toBeNull();

    const stored = await t.query(api.activities.get, { activityId: firstId });
    expect(stored).toMatchObject({
      state: "running",
      attempt: 1,
      startedAt: expect.any(Number),
    });
  });

  test("renews only the current fenced attempt", async () => {
    const t = convexTest(schema, modules);
    const activityId = await t.mutation(api.activities.schedule, scheduleArgs());
    const leased = await claim(t);
    if (!leased) throw new Error("Expected a claimed activity");

    vi.advanceTimersByTime(5_000);
    const renewed = await t.mutation(api.activities.renew, {
      activityId,
      attempt: leased.attempt,
      leaseToken: leased.leaseToken,
      progress: 0.25,
      progressMessage: "Separating stems",
    });
    expect(renewed).toMatchObject({ accepted: true, cancelRequested: false });
    expect(renewed.leaseExpiresAt).toBeGreaterThan(leased.leaseExpiresAt);

    const stale = await t.mutation(api.activities.renew, {
      activityId,
      attempt: leased.attempt,
      leaseToken: "stale-token",
    });
    expect(stale.accepted).toBe(false);
    expect(await t.query(api.activities.get, { activityId })).toMatchObject({
      progress: 0.25,
      progressMessage: "Separating stems",
    });
  });

  test("retries failures and fences a stale completion", async () => {
    const t = convexTest(schema, modules);
    const activityId = await t.mutation(api.activities.schedule, scheduleArgs());
    const first = await claim(t);
    if (!first) throw new Error("Expected a claimed activity");

    const failed = await t.mutation(api.activities.fail, {
      activityId,
      attempt: first.attempt,
      leaseToken: first.leaseToken,
      requestId: "failure-1",
      errorType: "ModelUnavailable",
      errorMessage: "temporary failure",
    });
    expect(failed).toEqual({ accepted: true, duplicate: false, retrying: true });
    const duplicateFailure = await t.mutation(api.activities.fail, {
      activityId,
      attempt: first.attempt,
      leaseToken: first.leaseToken,
      requestId: "failure-1",
      errorType: "ModelUnavailable",
      errorMessage: "temporary failure",
    });
    expect(duplicateFailure).toEqual({ accepted: true, duplicate: true, retrying: true });

    vi.advanceTimersByTime(1_000);
    const second = await claim(t, "worker-2");
    if (!second) throw new Error("Expected a retry claim");
    expect(second.attempt).toBe(2);

    const stale = await t.mutation(api.activities.complete, {
      activityId,
      attempt: first.attempt,
      leaseToken: first.leaseToken,
      requestId: "complete-stale",
      value: { instrumentalStorageId: "stale" },
    });
    expect(stale.accepted).toBe(false);

    const completed = await t.mutation(api.activities.complete, {
      activityId,
      attempt: second.attempt,
      leaseToken: second.leaseToken,
      requestId: "complete-2",
      value: { instrumentalStorageId: "instrumental" },
    });
    const duplicate = await t.mutation(api.activities.complete, {
      activityId,
      attempt: second.attempt,
      leaseToken: second.leaseToken,
      requestId: "complete-2",
      value: { instrumentalStorageId: "instrumental" },
    });
    expect(completed).toEqual({ accepted: true, duplicate: false });
    expect(duplicate).toEqual({ accepted: true, duplicate: true });
    expect(await t.query(api.activities.get, { activityId })).toMatchObject({
      state: "completed",
      attempt: 2,
      startedAt: expect.any(Number),
      completedAt: expect.any(Number),
      result: {
        kind: "success",
        value: { instrumentalStorageId: "instrumental" },
      },
    });
  });

  test("lease expiry is durably retried by the watchdog", async () => {
    const t = convexTest(schema, modules);
    const activityId = await t.mutation(api.activities.schedule, scheduleArgs());
    const first = await claim(t);
    if (!first) throw new Error("Expected a claimed activity");

    vi.setSystemTime(first.leaseExpiresAt + 1);
    await t.mutation(internal.activities.watchdog, { activityId });

    expect(await t.query(api.activities.get, { activityId })).toMatchObject({
      state: "scheduled",
      attempt: 1,
      lastErrorType: "WorkerLost",
    });
  });

  test("cancels queued and running activities", async () => {
    const t = convexTest(schema, modules);
    const queuedId = await t.mutation(api.activities.schedule, scheduleArgs());
    await t.mutation(api.activities.requestCancel, { activityId: queuedId });
    expect(await t.query(api.activities.get, { activityId: queuedId })).toMatchObject({
      state: "canceled",
    });

    const runningId = await t.mutation(
      api.activities.schedule,
      scheduleArgs({ taskQueue: "other-stems" }),
    );
    const running = await t.mutation(api.activities.claim, {
      protocolVersion,
      taskQueue: "other-stems",
      workerId: "worker",
      supportedActivities: [{ name: "media.separate", version: 1 }],
    });
    if (!running) throw new Error("Expected a claimed activity");
    await t.mutation(api.activities.requestCancel, { activityId: runningId });
    const renewal = await t.mutation(api.activities.renew, {
      activityId: runningId,
      attempt: running.attempt,
      leaseToken: running.leaseToken,
    });
    expect(renewal).toMatchObject({ accepted: true, cancelRequested: true });

    await t.mutation(api.activities.acknowledgeCancellation, {
      activityId: runningId,
      attempt: running.attempt,
      leaseToken: running.leaseToken,
      requestId: "cancel-ack",
    });
    expect(await t.query(api.activities.get, { activityId: runningId })).toMatchObject({
      state: "canceled",
    });
  });

  test("marks configured application errors non-retryable", async () => {
    const t = convexTest(schema, modules);
    const activityId = await t.mutation(api.activities.schedule, scheduleArgs());
    const leased = await claim(t);
    if (!leased) throw new Error("Expected a claimed activity");

    const result = await t.mutation(api.activities.fail, {
      activityId,
      attempt: leased.attempt,
      leaseToken: leased.leaseToken,
      requestId: "unsupported",
      errorType: "UnsupportedMedia",
      errorMessage: "No audio stream",
    });
    expect(result.retrying).toBe(false);
    expect(await t.query(api.activities.get, { activityId })).toMatchObject({
      state: "failed",
      result: {
        kind: "failed",
        errorType: "UnsupportedMedia",
      },
    });
  });

  test("registers scoped artifacts and deletes intermediaries when the scope closes", async () => {
    const t = convexTest(schema, modules);
    const scopeId = await t.mutation(api.artifacts.createScope, {});
    const activityId = await t.mutation(
      api.activities.schedule,
      scheduleArgs({
        artifactScopeId: scopeId,
        artifactSlots: ["intermediate", "final"],
        artifactDefinitions: [
          { slot: "intermediate", disposition: "intermediate" },
          { slot: "final", disposition: "retained" },
        ],
      }),
    );
    const leased = await claim(t);
    if (!leased) throw new Error("Expected a claimed activity");
    const [intermediateStorageId, finalStorageId] = await t.run(async (ctx) => [
      await ctx.storage.store(new Blob(["intermediate"])),
      await ctx.storage.store(new Blob(["final"])),
    ]);
    const identity = {
      activityId,
      attempt: leased.attempt,
      leaseToken: leased.leaseToken,
    };
    const intermediateId = await t.mutation(api.artifacts.registerUpload, {
      ...identity,
      slot: "intermediate",
      storageId: intermediateStorageId,
    });
    const finalId = await t.mutation(api.artifacts.registerUpload, {
      ...identity,
      slot: "final",
      storageId: finalStorageId,
    });

    await t.mutation(api.activities.complete, {
      ...identity,
      requestId: "complete-with-artifacts",
      value: { artifactId: finalId },
    });
    await t.mutation(api.artifacts.closeScope, { scopeId });
    await t.mutation(internal.artifacts.cleanupScope, { scopeId });

    expect(await t.query(api.artifacts.getUrl, { artifactId: intermediateId })).toBeNull();
    expect(await t.query(api.artifacts.getUrl, { artifactId: finalId })).not.toBeNull();
    expect(
      await t.run(async (ctx) => (await ctx.storage.get(intermediateStorageId)) !== null),
    ).toBe(false);
    expect(await t.run(async (ctx) => (await ctx.storage.get(finalStorageId)) !== null)).toBe(true);
  });

  test("binds a scope to one workflow and exposes the binding by workflow id", async () => {
    const t = convexTest(schema, modules);
    const scopeId = await t.mutation(api.artifacts.createScope, {});

    await t.mutation(api.artifacts.attachWorkflow, {
      scopeId,
      workflowId: "workflow-1",
    });

    expect(await t.query(api.artifacts.getScopeForWorkflow, { workflowId: "workflow-1" })).toBe(
      scopeId,
    );
    await expect(
      t.mutation(api.artifacts.attachWorkflow, {
        scopeId,
        workflowId: "workflow-2",
      }),
    ).rejects.toThrow("already attached");
  });

  test("allows only one upload per activity attempt and artifact slot", async () => {
    const t = convexTest(schema, modules);
    const scopeId = await t.mutation(api.artifacts.createScope, {});
    const activityId = await t.mutation(
      api.activities.schedule,
      scheduleArgs({
        artifactScopeId: scopeId,
        artifactSlots: ["final"],
        artifactDefinitions: [{ slot: "final", disposition: "retained" }],
      }),
    );
    const leased = await claim(t);
    if (!leased) throw new Error("Expected a claimed activity");
    const [firstStorageId, secondStorageId] = await t.run(async (ctx) => [
      await ctx.storage.store(new Blob(["first"])),
      await ctx.storage.store(new Blob(["second"])),
    ]);
    const identity = {
      activityId,
      attempt: leased.attempt,
      leaseToken: leased.leaseToken,
      slot: "final",
    };
    await t.mutation(api.artifacts.registerUpload, {
      ...identity,
      storageId: firstStorageId,
    });

    await expect(
      t.mutation(api.artifacts.registerUpload, {
        ...identity,
        storageId: secondStorageId,
      }),
    ).rejects.toThrow("already registered artifact slot");
  });

  test("sweeps old uploads that were never registered from component storage", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index++) {
        await ctx.storage.store(new Blob([`orphan-${index}`]));
      }
    });
    vi.advanceTimersByTime(24 * 60 * 60_000 + 1);

    const result = await t.mutation(internal.artifacts.runStorageSweep, {});

    expect(result).toBeNull();
    expect(
      await t.run(async (ctx) => await ctx.db.system.query("_storage").take(200)),
    ).toHaveLength(1);

    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();

    expect(
      await t.run(async (ctx) => await ctx.db.system.query("_storage").take(200)),
    ).toHaveLength(0);
  });

  test("removes terminal activity records after the retention window", async () => {
    const t = convexTest(schema, modules);
    const activityId = await t.mutation(api.activities.schedule, scheduleArgs());
    const leased = await claim(t);
    if (!leased) throw new Error("Expected a claimed activity");
    await t.mutation(api.activities.complete, {
      activityId,
      attempt: leased.attempt,
      leaseToken: leased.leaseToken,
      requestId: "complete-for-retention",
      value: {},
    });
    vi.advanceTimersByTime(7 * 24 * 60 * 60_000 + 1);

    await t.mutation(internal.activities.deleteTerminal, { activityId });

    expect(await t.query(api.activities.get, { activityId })).toBeNull();
  });
});
