/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

test("preflight reports invalid ready assets and lyrics without guessing", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = Date.now();
    const assetId = await ctx.db.insert("mediaAssets", {
      cacheKey: "legacy",
      extractor: "test",
      sourceId: "source",
      state: "ready",
      createdAt: now,
      updatedAt: now,
    } as never);
    await ctx.db.insert("mediaLyricTracks", {
      asset: assetId,
      source: "legacy",
      label: "Legacy",
      timing: "word",
      state: "ready",
      createdAt: now,
      updatedAt: now,
    } as never);
  });

  const assets = await t.query(internal.migration.workflowStateRedesign.preflightPage, {
    table: "mediaAssets",
    cursor: null,
    limit: 50,
  });
  const lyrics = await t.query(internal.migration.workflowStateRedesign.preflightPage, {
    table: "mediaLyricTracks",
    cursor: null,
    limit: 50,
  });
  expect(assets.blockers[0]?.reason).toContain("finalArtifactId");
  expect(lyrics.blockers[0]?.reason).toContain("observations or timedArtifactId");
});

test("preflight derives retained artifact owners from live application references", async () => {
  const t = convexTest(schema, modules);
  const assetId = await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("mediaAssets", {
      cacheKey: "ready",
      extractor: "test",
      sourceId: "source",
      state: "ready",
      finalArtifactId: "final-artifact",
      instrumentalArtifactId: "instrumental-artifact",
      createdAt: now,
      updatedAt: now,
    });
  });

  const result = await t.query(internal.migration.workflowStateRedesign.preflightPage, {
    table: "mediaAssets",
    cursor: null,
    limit: 50,
  });
  expect(result.artifactReferences).toEqual(
    expect.arrayContaining([
      {
        artifactId: "final-artifact",
        owner: assetId,
        slot: "artifactId",
        source: "mediaAssets.finalArtifactId",
      },
      {
        artifactId: "instrumental-artifact",
        owner: assetId,
        slot: "instrumentalArtifactId",
        source: "mediaAssets.instrumentalArtifactId",
      },
    ]),
  );
});
