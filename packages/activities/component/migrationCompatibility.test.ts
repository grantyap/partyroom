/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.{ts,js}");
const adoptArtifacts = makeFunctionReference<"mutation">("maintenance:adoptArtifacts");
const migrateActivities = makeFunctionReference<"mutation">("maintenance:migrateActivities");

test("the expand schema accepts and fences a legacy activity", async () => {
  const t = convexTest(schema, modules);
  const activityId = await t.run(async (ctx) => {
    return await ctx.db.insert("activities", {
      protocolVersion: 1,
      activityType: "legacy",
      activityVersion: 1,
      taskQueue: "legacy",
      state: "running",
      input: {},
      retryPolicy: {
        maximumAttempts: 1,
        initialIntervalMs: 1,
        backoffCoefficient: 1,
        maximumIntervalMs: 1,
        nonRetryableErrorTypes: [],
      },
      startToCloseTimeoutMs: 1,
      scheduleToCloseTimeoutMs: 1,
      scheduleDeadline: 1,
      nextAttemptAt: 1,
      attempt: 1,
      workerId: "old-worker",
      leaseToken: "old-token",
      leaseExpiresAt: 2,
      attemptDeadline: 2,
      createdAt: 1,
      updatedAt: 1,
    } as never);
  });

  expect(await t.run((ctx) => ctx.db.get(activityId))).toMatchObject({
    protocolVersion: 1,
    state: "running",
  });
});

async function legacyArtifactFixture() {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const now = Date.now();
    const scopeId = await ctx.db.insert("artifactScopes", {
      state: "open",
      workflowId: "legacy-workflow",
      expiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    const activityId = await ctx.db.insert("activities", {
      protocolVersion: 1,
      activityType: "legacy",
      activityVersion: 1,
      taskQueue: "legacy",
      state: "completed",
      input: {},
      artifactScopeId: scopeId,
      artifactSlots: ["published", "orphan"],
      artifactDefinitions: [
        { slot: "published", disposition: "retained" },
        { slot: "orphan", disposition: "retained" },
      ],
      retryPolicy: {
        maximumAttempts: 1,
        initialIntervalMs: 1,
        backoffCoefficient: 1,
        maximumIntervalMs: 1,
        nonRetryableErrorTypes: [],
      },
      startToCloseTimeoutMs: 1,
      scheduleToCloseTimeoutMs: 1,
      scheduleDeadline: now,
      nextAttemptAt: now,
      attempt: 1,
      result: { kind: "success", value: {} },
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    } as never);
    const publishedStorage = await ctx.storage.store(new Blob(["published"]));
    const orphanStorage = await ctx.storage.store(new Blob(["orphan"]));
    const missingStorage = await ctx.storage.store(new Blob(["missing"]));
    const published = await ctx.db.insert("artifacts", {
      scopeId,
      activityId,
      attempt: 1,
      slot: "published",
      disposition: "retained",
      storageId: publishedStorage,
      state: "staged",
      createdAt: now,
      updatedAt: now,
    } as never);
    const orphan = await ctx.db.insert("artifacts", {
      scopeId,
      activityId,
      attempt: 1,
      slot: "orphan",
      disposition: "retained",
      storageId: orphanStorage,
      state: "staged",
      createdAt: now,
      updatedAt: now,
    } as never);
    const missing = await ctx.db.insert("artifacts", {
      scopeId,
      activityId,
      attempt: 1,
      slot: "missing",
      disposition: "retained",
      storageId: missingStorage,
      state: "staged",
      createdAt: now,
      updatedAt: now,
    } as never);
    await ctx.storage.delete(missingStorage);
    return { activityId, published, orphan, missing };
  });
  return { t, ...seeded };
}

test("adopts only live references and dry-run does not write", async () => {
  const { t, published, orphan } = await legacyArtifactFixture();
  const reference = { artifactId: published, owner: "asset", slot: "published" };
  expect(
    await t.mutation(adoptArtifacts, {
      dryRun: true,
      references: [reference],
    }),
  ).toEqual({ changed: 1, issues: [] });
  expect(await t.run((ctx) => ctx.db.get(published))).not.toHaveProperty("owner");

  await t.mutation(adoptArtifacts, { dryRun: false, references: [reference] });
  await t.mutation(adoptArtifacts, { dryRun: false, references: [reference] });
  expect(await t.run((ctx) => ctx.db.get(published))).toMatchObject({
    state: "adopted",
    owner: "asset",
  });
  expect(await t.run((ctx) => ctx.db.get(orphan))).toMatchObject({ state: "staged" });
});

test("reports missing storage instead of publishing it", async () => {
  const { t, missing } = await legacyArtifactFixture();
  const result = await t.mutation(adoptArtifacts, {
    dryRun: false,
    references: [{ artifactId: missing, owner: "asset", slot: "missing" }],
  });
  expect(result.issues).toEqual([{ id: missing, reason: "artifact storage is missing" }]);
  expect(await t.run((ctx) => ctx.db.get(missing))).not.toHaveProperty("owner");
});

test("migrates a legacy activity idempotently", async () => {
  const { t, activityId } = await legacyArtifactFixture();
  const args = { cursor: null, limit: 100, dryRun: false };
  expect(await t.mutation(migrateActivities, args)).toMatchObject({ changed: 1 });
  expect(await t.mutation(migrateActivities, args)).toMatchObject({ changed: 0 });
  expect(await t.run((ctx) => ctx.db.get(activityId))).toMatchObject({ protocolVersion: 2 });
});
