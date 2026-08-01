/// <reference types="vite/client" />

import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.{ts,js}");

function activityArgs() {
  return {
    activityType: "media.resolve",
    activityVersion: 1,
    taskQueue: "media",
    queue: { leaseDurationMs: 10_000 },
    input: { jobId: "job-1" },
    retryPolicy: {
      maximumAttempts: 3,
      initialIntervalMs: 1_000,
      backoffCoefficient: 2,
      maximumIntervalMs: 30_000,
      nonRetryableErrorTypes: [],
    },
    startToCloseTimeoutMs: 60_000,
    scheduleToCloseTimeoutMs: 300_000,
  };
}

describe("workflow progress steps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("registers ordered steps and tracks custom work", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.workflowSteps.register, {
      workflowId: "workflow-1",
      steps: [
        { key: "resolve", label: "Resolve source", position: 0, kind: "activity" },
        { key: "fetchLyrics", label: "Fetch synced lyrics", position: 1, kind: "workflow" },
      ],
    });

    await t.mutation(api.workflowSteps.start, {
      workflowId: "workflow-1",
      key: "fetchLyrics",
    });
    await t.mutation(api.workflowSteps.finish, {
      workflowId: "workflow-1",
      key: "fetchLyrics",
      state: "completed",
    });

    expect(await t.query(api.workflowSteps.list, { workflowId: "workflow-1" })).toMatchObject([
      { key: "resolve", state: "pending", progress: 0 },
      { key: "fetchLyrics", state: "completed", progress: 1 },
    ]);
  });

  test("links activity state and finalizes unreached steps", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.workflowSteps.register, {
      workflowId: "workflow-1",
      steps: [
        { key: "resolve", label: "Resolve source", position: 0, kind: "activity" },
        { key: "download", label: "Download source", position: 1, kind: "activity" },
      ],
    });
    const activityId = await t.mutation(api.activities.schedule, activityArgs());
    await t.mutation(api.workflowSteps.startActivity, {
      workflowId: "workflow-1",
      key: "resolve",
    });
    await expect(
      t.mutation(api.workflowSteps.startActivity, {
        workflowId: "workflow-1",
        key: "resolve",
      }),
    ).rejects.toThrow("has already been run");
    await t.mutation(api.workflowSteps.linkActivity, {
      workflowId: "workflow-1",
      key: "resolve",
      activityId,
    });
    await t.mutation(api.workflowSteps.finalize, {
      workflowId: "workflow-1",
      succeeded: true,
    });

    expect(await t.query(api.workflowSteps.list, { workflowId: "workflow-1" })).toMatchObject([
      { key: "resolve", state: "queued", activityId },
      { key: "download", state: "skipped", progress: 1 },
    ]);
  });
});
