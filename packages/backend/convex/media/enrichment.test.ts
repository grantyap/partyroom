import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

describe("media enrichment", () => {
  test("upgrades only line-timed LRCLIB tracks to aligned word timing", async () => {
    const t = convexTest(schema, modules);
    const { enrichmentId, trackId } = await t.run(async (ctx) => {
      const now = Date.now();
      const assetId = await ctx.db.insert("mediaAssets", {
        cacheKey: "alignment-test",
        extractor: "youtube",
        sourceId: "alignment-test",
        state: "ready",
        duration: 180,
        createdAt: now,
        updatedAt: now,
      });
      const enrichmentId = await ctx.db.insert("mediaEnrichments", {
        asset: assetId,
        workflowId: "workflow",
        state: "processing",
        createdAt: now,
        updatedAt: now,
      });
      const trackId = await ctx.db.insert("mediaLyricTracks", {
        asset: assetId,
        source: "lrclib",
        label: "LRCLIB",
        timing: "line",
        state: "ready",
        observations: [
          { time: 10, duration: 3, value: "Sing this line" },
          { time: 13, duration: 2, value: "..." },
        ],
        suggestedOffsetMs: 10_000,
        createdAt: now,
        updatedAt: now,
      });
      return { enrichmentId, trackId };
    });

    const shouldAlign = await t.query(internal.media.enrichment.shouldAlignLrclibLyrics, {
      enrichmentId,
      workflowId: "workflow" as any,
    });
    expect(shouldAlign).toBe(true);

    await t.mutation(internal.media.enrichment.recordAlignedLrclibLyrics, {
      enrichmentId,
      workflowId: "workflow" as any,
      timedArtifactId: "aligned-lyrics",
    });

    const track = await t.run(async (ctx) => await ctx.db.get("mediaLyricTracks", trackId));
    expect(track).toMatchObject({
      timing: "word",
      timedArtifactId: "aligned-lyrics",
      suggestedOffsetMs: 0,
    });
    expect(track?.observations).toBeUndefined();
  });

  test("does not align media beyond the aligner's duration limit", async () => {
    const t = convexTest(schema, modules);
    const enrichmentId = await t.run(async (ctx) => {
      const now = Date.now();
      const assetId = await ctx.db.insert("mediaAssets", {
        cacheKey: "long-alignment-test",
        extractor: "youtube",
        sourceId: "long-alignment-test",
        state: "ready",
        duration: 301,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("mediaLyricTracks", {
        asset: assetId,
        source: "lrclib",
        label: "LRCLIB",
        timing: "line",
        state: "ready",
        observations: [{ time: 10, duration: 3, value: "Sing this line" }],
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("mediaEnrichments", {
        asset: assetId,
        workflowId: "workflow",
        state: "processing",
        createdAt: now,
        updatedAt: now,
      });
    });

    expect(
      await t.query(internal.media.enrichment.shouldAlignLrclibLyrics, {
        enrichmentId,
        workflowId: "workflow" as any,
      }),
    ).toBe(false);
  });
});
