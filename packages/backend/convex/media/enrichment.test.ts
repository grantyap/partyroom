import { afterEach, describe, expect, test, vi } from "vitest";
import { components, internal } from "../_generated/api";
import { cancelAssetEnrichment } from "./domain/assets";
import { mediaTest, completedArtifacts } from "../../test/media";

afterEach(() => vi.useRealTimers());
describe("media enrichment", () => {
  test("cancellation fences late domain writes and preserves published lyrics", async () => {
    vi.useFakeTimers();
    const t = mediaTest();
    const { assetId, enrichmentId } = await t.run(async (ctx) => {
      const now = Date.now();
      const assetId = await ctx.db.insert("mediaAssets", {
        cacheKey: "cancel",
        extractor: "test",
        sourceId: "cancel",
        state: "ready",
        finalArtifactId: "final",
        annotationsState: "processing",
        createdAt: now,
        updatedAt: now,
      });
      const enrichmentId = await ctx.db.insert("mediaEnrichments", {
        asset: assetId,
        state: "processing",
        workflowId: "workflow",
        createdAt: now,
        updatedAt: now,
      });
      return { assetId, enrichmentId };
    });
    const args = { enrichmentId, workflowId: "workflow" as any };
    await t.mutation(internal.media.enrichment.markGeneratedLyricsProcessing, args);
    const output = await completedArtifacts(t, "workflow", [
      "lyricsArtifactId",
      "timedLyricsArtifactId",
    ]);
    await t.mutation(internal.media.enrichment.recordGeneratedLyrics, {
      ...args,
      textArtifactId: output.lyricsArtifactId!,
      timedArtifactId: output.timedLyricsArtifactId!,
    });
    // A repeated start must not erase an already published track.
    await t.mutation(internal.media.enrichment.markGeneratedLyricsProcessing, args);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await t.run((ctx) => cancelAssetEnrichment(ctx, assetId));
    } finally {
      warning.mockRestore();
    }
    await expect(
      t.mutation(internal.media.enrichment.recordMelody, { ...args, artifactId: "late" }),
    ).rejects.toThrow("no longer current");
    const scopeId = await t.query(components.activities.artifacts.getScopeForWorkflow, {
      workflowId: "workflow",
    });
    await t.mutation(components.activities.artifacts.abandonScope, { scopeId: scopeId! });
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
    const track = await t.run((ctx) =>
      ctx.db
        .query("mediaLyricTracks")
        .withIndex("by_asset_and_source", (q) => q.eq("asset", assetId).eq("source", "generated"))
        .unique(),
    );
    expect(track).toMatchObject({ state: "ready", timedArtifactId: output.timedLyricsArtifactId });
    expect(
      await t.query(components.activities.artifacts.getUrl, {
        artifactId: output.timedLyricsArtifactId!,
      }),
    ).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(assetId))).toMatchObject({ annotationsState: "failed" });
    expect(await t.run((ctx) => ctx.db.get(enrichmentId))).toMatchObject({ state: "canceled" });
  });

  test("upgrades only line-timed LRCLIB tracks to aligned word timing", async () => {
    const t = mediaTest();
    const { enrichmentId, trackId } = await t.run(async (ctx) => {
      const now = Date.now();
      const assetId = await ctx.db.insert("mediaAssets", {
        cacheKey: "alignment-test",
        extractor: "youtube",
        sourceId: "alignment-test",
        state: "ready",
        finalArtifactId: "final",
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

    const { timedLyricsArtifactId } = await completedArtifacts(t, "workflow", [
      "timedLyricsArtifactId",
    ]);
    await t.mutation(internal.media.enrichment.recordAlignedLrclibLyrics, {
      enrichmentId,
      workflowId: "workflow" as any,
      timedArtifactId: timedLyricsArtifactId!,
    });

    const track = await t.run(async (ctx) => await ctx.db.get("mediaLyricTracks", trackId));
    expect(track).toMatchObject({
      timing: "word",
      timedArtifactId: timedLyricsArtifactId!,
      suggestedOffsetMs: 0,
    });
    expect(track?.observations).toBeUndefined();
  });

  test("sends line-timed lyrics from longer media to the lyrics worker", async () => {
    const t = mediaTest();
    const enrichmentId = await t.run(async (ctx) => {
      const now = Date.now();
      const assetId = await ctx.db.insert("mediaAssets", {
        cacheKey: "long-alignment-test",
        extractor: "youtube",
        sourceId: "long-alignment-test",
        state: "ready",
        finalArtifactId: "final",
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
    ).toBe(true);
  });
});
