/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { protocolVersion } from "./validators";
import { wire, type WireSchema } from "../src/wire";

const modules = import.meta.glob("./**/*.{ts,js}");
const claimArgs = {
  protocolVersion,
  taskQueue: "test",
  workerId: "worker",
  supportedActivities: [{ name: "test", version: 1 }],
};

async function setup(outputSchema: WireSchema = wire.object({ value: wire.string })) {
  const t = convexTest(schema, modules);
  const scopeId = await t.mutation(api.artifacts.createScope, {});
  await t.mutation(api.artifacts.attachWorkflow, { scopeId, workflowId: "workflow" });
  const args = {
    activityType: "test",
    activityVersion: 1,
    taskQueue: "test",
    queue: { leaseDurationMs: 1000, maxConcurrentActivities: 1 },
    input: {},
    inputSchema: wire.object({}),
    outputSchema,
    artifactScopeId: scopeId,
    retryPolicy: {
      maximumAttempts: 3,
      initialIntervalMs: 1000,
      maximumIntervalMs: 1000,
      backoffCoefficient: 1,
      nonRetryableErrorTypes: ["Permanent"],
    },
    startToCloseTimeoutMs: 5000,
    scheduleToCloseTimeoutMs: 30000,
  };
  const activityId = await t.mutation(api.activities.schedule, args);
  const lease = (await t.mutation(api.activities.claim, claimArgs))!;
  return { t, scopeId, args, activityId, lease, attemptToken: lease.attemptToken };
}
async function upload(t: ReturnType<typeof convexTest>, attemptToken: string, slot: string) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([slot])));
  return await t.mutation(api.artifacts.registerUpload, { attemptToken, slot, storageId });
}

describe("attempt capabilities and publication", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01"));
  });
  afterEach(() => vi.useRealTimers());

  test("rejects old workers and claims a compatible attempt exactly once", async () => {
    const { t, lease, args } = await setup();
    await expect(
      t.mutation(api.activities.claim, { ...claimArgs, protocolVersion: 1 } as never),
    ).rejects.toThrow();
    expect(await t.mutation(api.activities.claim, claimArgs)).toEqual(lease);
    await t.mutation(api.activities.schedule, args);
    expect(await t.mutation(api.activities.claim, { ...claimArgs, workerId: "other" })).toBeNull();
  });

  test("renews only a live capability", async () => {
    const { t, attemptToken, lease } = await setup();
    vi.setSystemTime(lease.leaseExpiresAt - 1);
    expect(await t.mutation(api.activities.renew, { attemptToken, progress: 0.5 })).toMatchObject({
      accepted: true,
    });
    expect(await t.mutation(api.activities.renew, { attemptToken: "unknown" })).toMatchObject({
      accepted: false,
    });
    vi.setSystemTime(lease.leaseExpiresAt + 1000);
    expect(await t.mutation(api.activities.renew, { attemptToken })).toMatchObject({
      accepted: false,
    });
  });

  test.each(["leaseExpiresAt", "attemptDeadline", "scheduleDeadline"] as const)(
    "rejects writes after %s even before the watchdog",
    async (deadline) => {
      const { t, lease, attemptToken } = await setup(
        wire.object({ file: wire.artifact("retained") }),
      );
      vi.setSystemTime(lease[deadline] + 1);
      expect(
        await t.mutation(api.activities.complete, { attemptToken, value: { file: "invented" } }),
      ).toMatchObject({ accepted: false });
      expect(await t.mutation(api.activities.renew, { attemptToken })).toMatchObject({
        accepted: false,
      });
      await expect(
        t.mutation(api.artifacts.createUpload, { attemptToken, slot: "file" }),
      ).rejects.toThrow("lease");
      await expect(t.query(api.activities.getAttemptInput, { attemptToken })).rejects.toThrow(
        "lease",
      );
    },
  );

  test("keeps retry receipts after another attempt starts and rejects conflicting outcomes", async () => {
    const { t, activityId, attemptToken } = await setup();
    const failure = { attemptToken, errorType: "Temporary", errorMessage: "retry" };
    expect(await t.mutation(api.activities.fail, failure)).toMatchObject({
      accepted: true,
      retrying: true,
    });
    vi.setSystemTime(Date.now() + 1001);
    const second = (await t.mutation(api.activities.claim, claimArgs))!;
    expect(second.attempt).toBe(2);
    expect(await t.mutation(api.activities.fail, failure)).toMatchObject({
      accepted: true,
      duplicate: true,
      retrying: true,
    });
    await expect(
      t.mutation(api.activities.complete, { attemptToken, value: { value: "stale" } }),
    ).rejects.toThrow("different result");
    const success = { attemptToken: second.attemptToken, value: { value: "done" } };
    expect(await t.mutation(api.activities.complete, success)).toMatchObject({
      accepted: true,
      duplicate: false,
    });
    expect(await t.mutation(api.activities.complete, success)).toMatchObject({
      accepted: true,
      duplicate: true,
    });
    await expect(
      t.mutation(api.activities.complete, { ...success, value: { value: "different" } }),
    ).rejects.toThrow("different result");
    expect(await t.query(api.activities.get, { activityId })).toMatchObject({
      state: "completed",
      attempt: 2,
    });
  });

  test("watchdog retries lost workers and permanent errors terminate", async () => {
    const { t, activityId, lease } = await setup();
    vi.setSystemTime(lease.leaseExpiresAt + 1);
    await t.mutation(internal.activities.watchdog, { activityId });
    expect(await t.query(api.activities.get, { activityId })).toMatchObject({
      state: "scheduled",
      lastErrorType: "WorkerLost",
    });
    vi.setSystemTime(Date.now() + 1001);
    const next = (await t.mutation(api.activities.claim, claimArgs))!;
    expect(
      await t.mutation(api.activities.fail, {
        attemptToken: next.attemptToken,
        errorType: "Permanent",
        errorMessage: "stop",
      }),
    ).toMatchObject({ retrying: false });
    expect(await t.query(api.activities.get, { activityId })).toMatchObject({ state: "failed" });
  });

  test("canceling the scope fences queued and running work without progress records", async () => {
    const { t, scopeId, args, activityId, attemptToken } = await setup();
    const queued = await t.mutation(api.activities.schedule, args);
    await t.mutation(api.artifacts.abandonScope, { scopeId });
    for (const id of [activityId, queued])
      expect(await t.query(api.activities.get, { activityId: id })).toMatchObject({
        state: "canceled",
      });
    expect(
      await t.mutation(api.activities.complete, { attemptToken, value: { value: "late" } }),
    ).toMatchObject({ accepted: false });
    await expect(t.mutation(api.activities.schedule, args)).rejects.toThrow("scope");
  });

  test("expires an expired scope and cleans its staged artifacts", async () => {
    const { t, scopeId, activityId, attemptToken } = await setup(
      wire.object({ file: wire.artifact("retained") }),
    );
    const file = await upload(t, attemptToken, "file");
    await t.run((ctx) => ctx.db.patch(scopeId, { expiresAt: Date.now() - 1 }));

    await t.mutation(internal.artifacts.expireScope, { scopeId });
    expect(await t.query(api.activities.get, { activityId })).toMatchObject({ state: "canceled" });
    expect(await t.run((ctx) => ctx.db.get(scopeId))).toMatchObject({ state: "abandoned" });

    await t.mutation(internal.artifacts.cleanupScope, { scopeId });
    expect(await t.query(api.artifacts.getUrl, { artifactId: file })).toBeNull();
  });

  test("rejects malformed outputs, missing uploads, and artifacts from another attempt", async () => {
    const { t, args, activityId, attemptToken } = await setup(
      wire.object({ file: wire.artifact("retained") }),
    );
    await expect(
      t.mutation(api.activities.complete, { attemptToken, value: {} }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.activities.complete, { attemptToken, value: { file: "invented" } }),
    ).rejects.toThrow();
    const file = await upload(t, attemptToken, "file");
    await t.mutation(api.activities.fail, {
      attemptToken,
      errorType: "Transient",
      errorMessage: "retry",
    });
    vi.setSystemTime(Date.now() + 1001);
    const next = (await t.mutation(api.activities.claim, claimArgs))!;
    await expect(
      t.mutation(api.activities.complete, { attemptToken: next.attemptToken, value: { file } }),
    ).rejects.toThrow("Invalid output artifact");
    expect(await t.query(api.activities.get, { activityId })).toMatchObject({ state: "running" });
    await expect(
      t.mutation(api.activities.schedule, { ...args, input: { extra: true } }),
    ).rejects.toThrow();
  });

  test.each(["closeScope", "abandonScope"] as const)(
    "%s preserves adopted outputs and deletes unowned outputs",
    async (close) => {
      const { t, scopeId, attemptToken } = await setup(
        wire.object({
          published: wire.artifact("retained"),
          unowned: wire.artifact("retained"),
          scratch: wire.artifact("intermediate"),
        }),
      );
      const published = await upload(t, attemptToken, "published");
      const unowned = await upload(t, attemptToken, "unowned");
      const scratch = await upload(t, attemptToken, "scratch");
      await t.mutation(api.activities.complete, {
        attemptToken,
        value: { published, unowned, scratch },
      });
      await expect(
        t.mutation(api.artifacts.adopt, {
          workflowId: "other",
          owner: "asset",
          artifacts: [{ artifactId: published, slot: "published" }],
        }),
      ).rejects.toThrow("another run");
      await t.mutation(api.artifacts.adopt, {
        workflowId: "workflow",
        owner: "asset",
        artifacts: [{ artifactId: published, slot: "published" }],
      });
      await expect(
        t.mutation(api.artifacts.deleteArtifact, { artifactId: published, owner: "other" }),
      ).rejects.toThrow("owned");
      await t.mutation(api.artifacts[close], { scopeId });
      await t.mutation(internal.artifacts.cleanupScope, { scopeId });
      expect(await t.query(api.artifacts.getUrl, { artifactId: published })).not.toBeNull();
      for (const artifactId of [unowned, scratch])
        expect(await t.query(api.artifacts.getUrl, { artifactId })).toBeNull();
      await t.mutation(api.artifacts.deleteArtifact, { artifactId: published, owner: "asset" });
      expect(await t.query(api.artifacts.getUrl, { artifactId: published })).toBeNull();
    },
  );

  test("registration is idempotent for the same upload, but does not replace a slot", async () => {
    const { t, attemptToken } = await setup(wire.object({ file: wire.artifact("retained") }));
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["file"])));
    const args = { attemptToken, slot: "file", storageId };
    const id = await t.mutation(api.artifacts.registerUpload, args);
    expect(await t.mutation(api.artifacts.registerUpload, args)).toBe(id);
    await expect(upload(t, attemptToken, "file")).rejects.toThrow("already registered");
  });

  test("schema rejects running activities without a lease and success without a result", async () => {
    const { t, activityId } = await setup();
    await expect(
      t.run((ctx) => ctx.db.patch(activityId, { leaseToken: undefined })),
    ).rejects.toThrow();
    await expect(
      t.run((ctx) => ctx.db.patch(activityId, { state: "completed", completedAt: Date.now() })),
    ).rejects.toThrow();
  });
});
