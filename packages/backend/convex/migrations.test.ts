/// <reference types="vite/client" />
import migrationComponent from "@convex-dev/migrations/test";
import { runToCompletion } from "@convex-dev/migrations";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.{ts,js}");

function setup() {
  const t = convexTest(schema, modules);
  migrationComponent.register(t);
  return t;
}

async function legacyJob(t: ReturnType<typeof setup>, state: "processing" | "ready") {
  return await t.run(async (ctx) => {
    const now = Date.now();
    let asset: string | undefined;
    if (state === "ready") {
      asset = await ctx.db.insert("mediaAssets", {
        cacheKey: "legacy",
        extractor: "test",
        sourceId: "source",
        state: "ready",
        finalArtifactId: "artifact",
        createdAt: now,
        updatedAt: now,
      } as never);
    }
    return await ctx.db.insert("mediaJobs", {
      requestKey: crypto.randomUUID(),
      encryptedSource: "source",
      sourceIv: "iv",
      requestedBy: "user",
      state,
      stage: "download",
      progress: 0.5,
      asset,
      workflowId: "workflow",
      createdAt: now,
      updatedAt: now,
    } as never);
  });
}

describe("workflow-state-redesign-v1 application migrations", () => {
  test("skips an unfinished legacy job", async () => {
    const t = setup();
    const jobId = await legacyJob(t, "processing");
    await t.run(async (ctx) => {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.migrations.workflowStateRedesignV1MediaJobs,
      );
    });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ state: "processing" });
    await t.run(async (ctx) => {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.migrations.workflowStateRedesignV1MediaJobs,
      );
    });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toHaveProperty("stage");
  });

  test("a failed batch can be fixed and retried without guessing", async () => {
    const t = setup();
    const migratedBeforeFailure = await legacyJob(t, "ready");
    const jobId = await legacyJob(t, "ready");
    await t.run((ctx) => ctx.db.patch(jobId, { asset: undefined }));
    await expect(
      t.run(async (ctx) => {
        await runToCompletion(
          ctx,
          components.migrations,
          internal.migrations.workflowStateRedesignV1MediaJobs,
        );
      }),
    ).rejects.toThrow("ready job needs asset and workflowId");
    expect(await t.run((ctx) => ctx.db.get(migratedBeforeFailure))).toHaveProperty(
      "stage",
      "download",
    );
    expect(await t.run((ctx) => ctx.db.get(jobId))).toHaveProperty("stage", "download");
    const replacementAsset = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("mediaAssets", {
        cacheKey: "replacement",
        extractor: "test",
        sourceId: "replacement",
        state: "ready",
        finalArtifactId: "artifact",
        createdAt: now,
        updatedAt: now,
      });
    });
    await t.run((ctx) => ctx.db.patch(jobId, { asset: replacementAsset }));
    await t.run(async (ctx) => {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.migrations.workflowStateRedesignV1MediaJobs,
      );
    });
    expect(await t.run((ctx) => ctx.db.get(migratedBeforeFailure))).not.toHaveProperty("stage");
    expect(await t.run((ctx) => ctx.db.get(jobId))).not.toHaveProperty("stage");
  });

  test("dry-run rolls back application writes", async () => {
    const t = setup();
    const jobId = await legacyJob(t, "processing");
    await expect(
      t.run(async (ctx) => {
        await runToCompletion(
          ctx,
          components.migrations,
          internal.migrations.workflowStateRedesignV1MediaJobs,
          { dryRun: true },
        );
      }),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(jobId))).toHaveProperty("stage", "download");
  });
});
