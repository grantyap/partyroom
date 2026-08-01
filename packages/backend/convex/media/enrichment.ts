import { vResultValidator } from "@convex-dev/workpool";
import { vWorkflowId } from "@convex-dev/workflow";
import { type ArtifactId, type ActivityOutput } from "@partyroom/activities";
import { mediaActivities } from "@partyroom/media-activities";
import { v, type Validator } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { activities, cancelWorkflow, managedWorkflow } from "../activities/workflowManager";
import { getLyricTrack } from "./service";
import { lyricObservation } from "./validators";

async function requireCurrentEnrichment(
  ctx: Pick<QueryCtx, "db">,
  enrichmentId: Id<"mediaEnrichments">,
  workflowId: string,
) {
  const enrichment = await ctx.db.get("mediaEnrichments", enrichmentId);
  if (!enrichment || enrichment.workflowId !== workflowId) {
    throw new Error("Media enrichment workflow is no longer current");
  }
  const asset = await ctx.db.get("mediaAssets", enrichment.asset);
  if (!asset) throw new Error("Media enrichment references a missing asset");
  return { enrichment, asset };
}

async function mediaArtifactUrl(ctx: QueryCtx, artifactId: string | undefined) {
  return artifactId ? await activities.getArtifactUrl(ctx, artifactId as ArtifactId) : null;
}

async function failCurrentEnrichment(
  ctx: MutationCtx,
  enrichmentId: Id<"mediaEnrichments">,
  workflowId: string,
  state: "failed" | "canceled",
  errorMessage: string,
) {
  const enrichment = await ctx.db.get("mediaEnrichments", enrichmentId);
  if (!enrichment || enrichment.workflowId !== workflowId) return;
  const asset = await ctx.db.get("mediaAssets", enrichment.asset);
  if (!asset) return;
  const generated = await getLyricTrack(ctx, asset._id, "generated");
  const now = Date.now();
  if (!generated || generated.state === "processing") {
    const value = {
      asset: asset._id,
      source: "generated",
      label: "Generated",
      timing: "word" as const,
      state: "failed" as const,
      error: errorMessage.slice(0, 2_000),
      updatedAt: now,
    };
    if (generated) await ctx.db.patch("mediaLyricTracks", generated._id, value);
    else await ctx.db.insert("mediaLyricTracks", { ...value, createdAt: now });
  }
  if (asset.annotationsState === "processing") {
    await ctx.db.patch("mediaAssets", asset._id, {
      annotationsState: "failed",
      annotationsError: errorMessage.slice(0, 2_000),
      updatedAt: now,
    });
  }
  await ctx.db.patch("mediaEnrichments", enrichmentId, {
    state,
    error: errorMessage.slice(0, 2_000),
    updatedAt: now,
  });
}

export const start = internalMutation({
  args: { jobId: v.id("mediaJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("mediaJobs", jobId);
    if (!job?.asset) throw new Error("Media job has no claimed asset");
    const asset = await ctx.db.get("mediaAssets", job.asset);
    if (!asset || asset.activeJob !== jobId) {
      throw new Error("Media job no longer owns its claimed asset");
    }

    const existing = await ctx.db
      .query("mediaEnrichments")
      .withIndex("by_asset", (q) => q.eq("asset", asset._id))
      .unique();
    if (existing?.workflowId && existing.state === "processing") {
      await cancelWorkflow(ctx, existing.workflowId as any);
    }
    for (const activity of existing?.activeActivities ?? []) {
      await activities.cancel(ctx, activity.activityId as any);
    }

    const now = Date.now();
    const enrichmentId =
      existing?._id ??
      (await ctx.db.insert("mediaEnrichments", {
        asset: asset._id,
        state: "processing",
        createdAt: now,
        updatedAt: now,
      }));
    if (existing) {
      await ctx.db.patch("mediaEnrichments", existing._id, {
        workflowId: undefined,
        state: "processing",
        activeActivities: [],
        stepTimings: [],
        error: undefined,
        updatedAt: now,
      });
    }
    const workflowId = await managedWorkflow.start(
      ctx,
      internal.media.enrichment.mediaEnrichment,
      { enrichmentId },
      {
        onComplete: internal.media.enrichment.onComplete,
        context: { enrichmentId },
      },
    );
    await ctx.db.patch("mediaEnrichments", enrichmentId, {
      workflowId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markGeneratedLyricsProcessing = internalMutation({
  args: {
    enrichmentId: v.id("mediaEnrichments"),
    workflowId: vWorkflowId,
  },
  returns: v.null(),
  handler: async (ctx, { enrichmentId, workflowId }) => {
    const { asset } = await requireCurrentEnrichment(ctx, enrichmentId, workflowId);
    const existing = await getLyricTrack(ctx, asset._id, "generated");
    const now = Date.now();
    const value = {
      asset: asset._id,
      source: "generated",
      label: "Generated",
      timing: "word" as const,
      state: "processing" as const,
      textArtifactId: undefined,
      timedArtifactId: undefined,
      observations: undefined,
      metadata: undefined,
      suggestedOffsetMs: undefined,
      error: undefined,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch("mediaLyricTracks", existing._id, value);
    else await ctx.db.insert("mediaLyricTracks", { ...value, createdAt: now });
    return null;
  },
});

export const recordGeneratedLyrics = internalMutation({
  args: {
    enrichmentId: v.id("mediaEnrichments"),
    workflowId: vWorkflowId,
    textArtifactId: v.string(),
    timedArtifactId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { asset } = await requireCurrentEnrichment(ctx, args.enrichmentId, args.workflowId);
    const track = await getLyricTrack(ctx, asset._id, "generated");
    if (!track) throw new Error("Generated lyric track was not initialized");
    await ctx.db.patch("mediaLyricTracks", track._id, {
      state: "ready",
      textArtifactId: args.textArtifactId,
      timedArtifactId: args.timedArtifactId,
      error: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const recordMelody = internalMutation({
  args: {
    enrichmentId: v.id("mediaEnrichments"),
    workflowId: vWorkflowId,
    artifactId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { asset } = await requireCurrentEnrichment(ctx, args.enrichmentId, args.workflowId);
    await ctx.db.patch("mediaAssets", asset._id, {
      melodyArtifactId: args.artifactId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const recordAnnotations = internalMutation({
  args: {
    enrichmentId: v.id("mediaEnrichments"),
    workflowId: vWorkflowId,
    annotationsArtifactId: v.string(),
    midiArtifactId: v.string(),
    musicXmlArtifactId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { asset } = await requireCurrentEnrichment(ctx, args.enrichmentId, args.workflowId);
    await ctx.db.patch("mediaAssets", asset._id, {
      annotationsArtifactId: args.annotationsArtifactId,
      midiArtifactId: args.midiArtifactId,
      musicXmlArtifactId: args.musicXmlArtifactId,
      annotationsState: "ready",
      annotationsError: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markAnnotationsFailed = internalMutation({
  args: {
    enrichmentId: v.id("mediaEnrichments"),
    workflowId: vWorkflowId,
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { asset } = await requireCurrentEnrichment(ctx, args.enrichmentId, args.workflowId);
    await ctx.db.patch("mediaAssets", asset._id, {
      annotationsState: "failed",
      annotationsError: args.errorMessage.slice(0, 2_000),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const getLyricOffsetSuggestionInputs = internalQuery({
  args: {
    enrichmentId: v.id("mediaEnrichments"),
    workflowId: vWorkflowId,
  },
  returns: v.union(
    v.null(),
    v.object({
      generatedLyricsUrl: v.string(),
      referenceObservations: v.array(lyricObservation),
      referenceTiming: v.union(v.literal("word"), v.literal("line")),
    }),
  ),
  handler: async (ctx, { enrichmentId, workflowId }) => {
    const { asset } = await requireCurrentEnrichment(ctx, enrichmentId, workflowId);
    const [generated, lrclib] = await Promise.all([
      getLyricTrack(ctx, asset._id, "generated"),
      getLyricTrack(ctx, asset._id, "lrclib"),
    ]);
    if (
      generated?.state !== "ready" ||
      !generated.timedArtifactId ||
      lrclib?.state !== "ready" ||
      !lrclib.observations?.length
    ) {
      return null;
    }
    const generatedLyricsUrl = await mediaArtifactUrl(ctx, generated.timedArtifactId);
    return generatedLyricsUrl
      ? {
          generatedLyricsUrl,
          referenceObservations: lrclib.observations,
          referenceTiming: lrclib.timing,
        }
      : null;
  },
});

export const recordSuggestedLyricOffset = internalMutation({
  args: {
    enrichmentId: v.id("mediaEnrichments"),
    workflowId: vWorkflowId,
    suggestedOffsetMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { asset } = await requireCurrentEnrichment(ctx, args.enrichmentId, args.workflowId);
    const track = await getLyricTrack(ctx, asset._id, "lrclib");
    if (track) {
      await ctx.db.patch("mediaLyricTracks", track._id, {
        suggestedOffsetMs: args.suggestedOffsetMs,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export const complete = internalMutation({
  args: {
    enrichmentId: v.id("mediaEnrichments"),
    workflowId: vWorkflowId,
  },
  returns: v.null(),
  handler: async (ctx, { enrichmentId, workflowId }) => {
    await requireCurrentEnrichment(ctx, enrichmentId, workflowId);
    await ctx.db.patch("mediaEnrichments", enrichmentId, {
      state: "ready",
      error: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const mediaEnrichment = managedWorkflow
  .define({ args: { enrichmentId: v.id("mediaEnrichments") } })
  .handler(async (step, { enrichmentId }) => {
    const runActivity = async <Kind extends "transcribe" | "analyzeMelody" | "assembleAnnotations">(
      kind: Kind,
    ): Promise<ActivityOutput<(typeof mediaActivities)[Kind]>> => {
      const activityId = await step.runMutation(
        internal.media.enrichmentActivities.schedule,
        { enrichmentId, workflowId: step.workflowId, kind },
        { name: `schedule-${kind}`, inline: true },
      );
      return await step.awaitEvent<ActivityOutput<(typeof mediaActivities)[Kind]>>({
        name: activityId,
        validator: mediaActivities[kind].output as Validator<
          ActivityOutput<(typeof mediaActivities)[Kind]>,
          any,
          any
        >,
      });
    };

    await step.runMutation(
      internal.media.enrichment.markGeneratedLyricsProcessing,
      { enrichmentId, workflowId: step.workflowId },
      { name: "mark-generated-lyrics-processing", inline: true },
    );

    const transcriptionBranch = (async () => {
      const result = await runActivity("transcribe");
      await step.runMutation(
        internal.media.enrichment.recordGeneratedLyrics,
        {
          enrichmentId,
          workflowId: step.workflowId,
          textArtifactId: result.lyricsArtifactId,
          timedArtifactId: result.timedLyricsArtifactId,
        },
        { name: "record-generated-lyrics", inline: true },
      );
    })();
    const melodyBranch = (async () => {
      try {
        const result = await runActivity("analyzeMelody");
        await step.runMutation(
          internal.media.enrichment.recordMelody,
          { enrichmentId, workflowId: step.workflowId, artifactId: result.artifactId },
          { name: "record-melody", inline: true },
        );
        return true;
      } catch (error) {
        await step.runMutation(
          internal.media.enrichment.markAnnotationsFailed,
          {
            enrichmentId,
            workflowId: step.workflowId,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          { name: "mark-melody-failed", inline: true },
        );
        return false;
      }
    })();

    const [, hasMelody] = await Promise.all([transcriptionBranch, melodyBranch]);

    try {
      const inputs = await step.runQuery(
        internal.media.enrichment.getLyricOffsetSuggestionInputs,
        { enrichmentId, workflowId: step.workflowId },
        { name: "prepare-lyric-offset", inline: true },
      );
      if (inputs) {
        const suggestedOffsetMs = await step.runAction(
          internal.media.lrclib.suggestOffset,
          { requestId: enrichmentId, ...inputs },
          { name: "suggest-lyric-offset" },
        );
        if (suggestedOffsetMs !== null) {
          await step.runMutation(
            internal.media.enrichment.recordSuggestedLyricOffset,
            { enrichmentId, workflowId: step.workflowId, suggestedOffsetMs },
            { name: "record-lyric-offset", inline: true },
          );
        }
      }
    } catch (error) {
      console.warn("[lrclib] Unable to suggest lyrics offset", {
        enrichmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (hasMelody) {
      try {
        const annotations = await runActivity("assembleAnnotations");
        await step.runMutation(
          internal.media.enrichment.recordAnnotations,
          {
            enrichmentId,
            workflowId: step.workflowId,
            annotationsArtifactId: annotations.annotationsArtifactId,
            midiArtifactId: annotations.midiArtifactId,
            musicXmlArtifactId: annotations.musicXmlArtifactId,
          },
          { name: "record-annotations", inline: true },
        );
      } catch (error) {
        await step.runMutation(
          internal.media.enrichment.markAnnotationsFailed,
          {
            enrichmentId,
            workflowId: step.workflowId,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          { name: "mark-annotations-failed", inline: true },
        );
      }
    }

    await step.runMutation(
      internal.media.enrichment.complete,
      { enrichmentId, workflowId: step.workflowId },
      { name: "complete-enrichment", inline: true },
    );
  });

export const onComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ enrichmentId: v.id("mediaEnrichments") }),
  },
  returns: v.null(),
  handler: async (ctx, { workflowId, result, context }) => {
    if (result.kind === "success") return null;
    await failCurrentEnrichment(
      ctx,
      context.enrichmentId,
      workflowId,
      result.kind === "canceled" ? "canceled" : "failed",
      result.kind === "failed" ? result.error : "Media enrichment was canceled",
    );
    return null;
  },
});
