import { describe, expect, test } from "bun:test";
import { defineActivity, defineQueue, wire } from "@partyroom/activities";
import { claimRequestSchema } from "./protocol";
import { ActivityWorker, ApplicationError, defineHandler, runManagedProcess } from "./runtime";

const queue = defineQueue("test", { leaseDurationMs: 30_000 });
const activity = defineActivity({
  name: "test.echo",
  version: 1,
  queue,
  input: wire.object({ value: wire.string }),
  output: wire.object({ echoed: wire.string }),
  startToCloseTimeoutMs: 60_000,
  scheduleToCloseTimeoutMs: 300_000,
});
const artifactActivity = defineActivity({
  name: "test.artifact",
  version: 1,
  queue,
  input: wire.object({ value: wire.string }),
  output: wire.object({ file: wire.artifact("retained") }),
  startToCloseTimeoutMs: 60_000,
  scheduleToCloseTimeoutMs: 300_000,
});

function claimBody(leaseDurationMs = 30_000) {
  const now = Date.now();
  return {
    protocolVersion: 1,
    activityId: "activity-1",
    activityType: "test.echo",
    activityVersion: 1,
    taskQueue: "test",
    attempt: 1,
    leaseToken: "lease-token",
    leaseExpiresAt: now + leaseDurationMs,
    attemptDeadline: now + 60_000,
    scheduleDeadline: now + 300_000,
    input: { value: "hello" },
    artifactSlots: [],
  };
}

describe("ActivityWorker", () => {
  test("rejects missing or incompatible claim protocol versions", () => {
    const claim = {
      taskQueue: "test",
      workerId: "worker",
      supportedActivities: [{ name: "test.echo", version: 1 }],
    };
    expect(() => claimRequestSchema.parse(claim)).toThrow();
    expect(() => claimRequestSchema.parse({ ...claim, protocolVersion: 2 })).toThrow();
    expect(claimRequestSchema.parse({ ...claim, protocolVersion: 1 })).toEqual({
      ...claim,
      protocolVersion: 1,
    });
  });

  test("force-kills a managed process that ignores cancellation", async () => {
    const controller = new AbortController();
    const running = runManagedProcess(
      [process.execPath, "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 30_000)"],
      {
        signal: controller.signal,
        terminateTimeoutMs: 50,
      },
    );
    await Bun.sleep(100);
    controller.abort(new Error("cancelled"));
    await expect(running).rejects.toThrow("cancelled");
  });

  test("renews a lease while an async handler is running", async () => {
    let claimed = false;
    let renewals = 0;
    let resolveCompleted!: () => void;
    const completion = new Promise<void>((resolve) => (resolveCompleted = resolve));
    const fetch = async (input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      if (path === "/workers/claim") {
        if (claimed) return Response.json(null);
        claimed = true;
        return Response.json(claimBody(600));
      }
      if (path === "/workers/renew") {
        renewals += 1;
        return Response.json({
          accepted: true,
          cancelRequested: false,
          leaseExpiresAt: Date.now() + 600,
        });
      }
      if (path === "/workers/complete") {
        resolveCompleted();
        return Response.json({ accepted: true, duplicate: false });
      }
      throw new Error(`Unexpected path ${path}`);
    };
    const worker = new ActivityWorker({
      apiUrl: "http://activities.test/workers/",
      token: "token",
      workerId: "worker",
      taskQueue: "test",
      activities: [
        defineHandler(activity, async (context, input) => {
          await context.runProcess([process.execPath, "-e", "setTimeout(() => {}, 800)"]);
          return { echoed: input.value };
        }),
      ],
      idlePollIntervalMs: 100,
      fetch: fetch as typeof globalThis.fetch,
    });

    worker.start();
    await completion;
    const health = worker.health();
    await worker.stop();

    expect(renewals).toBeGreaterThanOrEqual(2);
    expect(health.lastRenewalAt).toBeNumber();
    expect(health.eventLoopLagMs).toBeNumber();
  });

  test("buffers progress until the lease loop survives a transient renewal failure", async () => {
    let claimed = false;
    let renewals = 0;
    let reportedProgress = false;
    let resolveCompleted!: () => void;
    const completion = new Promise<void>((resolve) => (resolveCompleted = resolve));
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      if (path === "/workers/claim") {
        if (claimed) return Response.json(null);
        claimed = true;
        return Response.json(claimBody(900));
      }
      if (path === "/workers/renew") {
        renewals += 1;
        if (renewals === 1) return Response.json({ error: "temporary" }, { status: 500 });
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.progress === 0.5) reportedProgress = true;
        return Response.json({
          accepted: true,
          cancelRequested: false,
          leaseExpiresAt: Date.now() + 900,
        });
      }
      if (path === "/workers/complete") {
        resolveCompleted();
        return Response.json({ accepted: true, duplicate: false });
      }
      throw new Error(`Unexpected path ${path}`);
    };
    const worker = new ActivityWorker({
      apiUrl: "http://activities.test/workers/",
      token: "token",
      workerId: "worker",
      taskQueue: "test",
      activities: [
        defineHandler(activity, async (context, input) => {
          await context.reportProgress(0.5, "working");
          await context.runProcess([process.execPath, "-e", "setTimeout(() => {}, 900)"]);
          return { echoed: input.value };
        }),
      ],
      idlePollIntervalMs: 100,
      fetch: fetch as typeof globalThis.fetch,
    });

    worker.start();
    await completion;
    await worker.stop();

    expect(renewals).toBeGreaterThanOrEqual(2);
    expect(reportedProgress).toBeTrue();
  });

  test("claims, validates, executes, and completes an activity", async () => {
    let claimed = false;
    let completed: Record<string, unknown> | undefined;
    let resolveCompleted!: () => void;
    const completion = new Promise<void>((resolve) => (resolveCompleted = resolve));
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (path === "/workers/claim") {
        expect(body.protocolVersion).toBe(1);
        if (claimed) return Response.json(null);
        claimed = true;
        return Response.json(claimBody());
      }
      if (path === "/workers/complete") {
        completed = body;
        resolveCompleted();
        return Response.json({ accepted: true, duplicate: false });
      }
      if (path === "/workers/renew") {
        return Response.json({ accepted: true, cancelRequested: false });
      }
      throw new Error(`Unexpected path ${path}`);
    };
    const worker = new ActivityWorker({
      apiUrl: "http://activities.test/workers/",
      token: "token",
      workerId: "worker",
      taskQueue: "test",
      activities: [defineHandler(activity, async (_ctx, input) => ({ echoed: input.value }))],
      idlePollIntervalMs: 100,
      fetch: fetch as typeof globalThis.fetch,
    });

    worker.start();
    await completion;
    await worker.stop();

    expect(completed).toMatchObject({
      activityId: "activity-1",
      attempt: 1,
      leaseToken: "lease-token",
      value: { echoed: "hello" },
    });
    expect(completed?.requestId).toBeString();
  });

  test("reports typed application failures", async () => {
    let claimed = false;
    let failure: Record<string, unknown> | undefined;
    let resolveFailure!: () => void;
    const failed = new Promise<void>((resolve) => (resolveFailure = resolve));
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      if (path === "/workers/claim") {
        if (claimed) return Response.json(null);
        claimed = true;
        return Response.json(claimBody());
      }
      if (path === "/workers/fail") {
        failure = JSON.parse(String(init?.body));
        resolveFailure();
        return Response.json({ accepted: true, duplicate: false, retrying: false });
      }
      throw new Error(`Unexpected path ${path}`);
    };
    const worker = new ActivityWorker({
      apiUrl: "http://activities.test/workers/",
      token: "token",
      workerId: "worker",
      taskQueue: "test",
      activities: [
        defineHandler(activity, async () => {
          throw new ApplicationError("bad input", "UnsupportedInput", true);
        }),
      ],
      idlePollIntervalMs: 100,
      fetch: fetch as typeof globalThis.fetch,
    });

    worker.start();
    await failed;
    await worker.stop();

    expect(failure).toMatchObject({
      errorType: "UnsupportedInput",
      errorMessage: "bad input",
      nonRetryable: true,
    });
  });

  test("uploads and registers declared artifacts before completing", async () => {
    let claimed = false;
    let registered: Record<string, unknown> | undefined;
    let completed: Record<string, unknown> | undefined;
    let resolveCompleted!: () => void;
    const completion = new Promise<void>((resolve) => (resolveCompleted = resolve));
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      if (path === "/workers/claim") {
        if (claimed) return Response.json(null);
        claimed = true;
        return Response.json({
          ...claimBody(),
          activityType: "test.artifact",
          artifactSlots: ["file"],
        });
      }
      if (path === "/workers/artifact-upload-url") {
        return Response.json({ uploadUrl: "http://upload.test/file" });
      }
      if (path === "/file") {
        expect(init?.body).toBe("contents");
        return Response.json({ storageId: "storage-1" });
      }
      if (path === "/workers/artifact-register") {
        registered = JSON.parse(String(init?.body));
        return Response.json({ artifactId: "artifact-1" });
      }
      if (path === "/workers/complete") {
        completed = JSON.parse(String(init?.body));
        resolveCompleted();
        return Response.json({ accepted: true, duplicate: false });
      }
      throw new Error(`Unexpected path ${path}`);
    };
    const worker = new ActivityWorker({
      apiUrl: "http://activities.test/workers/",
      token: "token",
      workerId: "worker",
      taskQueue: "test",
      activities: [
        defineHandler(artifactActivity, async (context) => ({
          file: await context.uploadArtifact("file", "contents", "text/plain"),
        })),
      ],
      idlePollIntervalMs: 100,
      fetch: fetch as typeof globalThis.fetch,
    });

    worker.start();
    await completion;
    await worker.stop();

    expect(registered).toMatchObject({
      activityId: "activity-1",
      attempt: 1,
      leaseToken: "lease-token",
      slot: "file",
      storageId: "storage-1",
    });
    expect(completed).toMatchObject({ value: { file: "artifact-1" } });
  });
});
