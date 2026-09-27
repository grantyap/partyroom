import { vResultValidator } from "@convex-dev/workpool";
import { vWorkflowId, type WorkflowId } from "@convex-dev/workflow";
import {
  activityStep,
  type ActivityDefinition,
  type ActivityInput,
  type ActivityOutput,
  type ArtifactId,
} from "@partyroom/activities";
import { mediaActivities } from "@partyroom/media-activities";
import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { activities, cancelWorkflow, managedWorkflow } from "../activities/workflowManager";
import { getLyricTrack } from "./domain/lyrics";
import { lyricObservation } from "./validators";
import { rowWorkflowVersion } from "../migration/workflowRouting";

async function requireCurrentEnrichment(
  ctx: Pick<QueryCtx, "db">,
  enrichmentId: Id<"mediaEnrichments">,
  workflowId: string,
) {
  const enrichment = await ctx.db.get("mediaEnrichments", enrichmentId);
  if (!enrichment || enrichment.workflowId !== workflowId || enrichment.state !== "processing") {
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
  if (!enrichment || enrichment.workflowId !== workflowId || enrichment.state !== "processing")
    return;
  const asset = await ctx.db.get("mediaAssets", enrichment.asset);
  if (!asset) return;
  await ctx.db.patch(asset._id, { melodyArtifactId: undefined });
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
  args: { jobId: v.id("mediaJobs"), workflowId: vWorkflowId },
  returns: v.null(),
  handler: async (ctx, { jobId, workflowId: parentWorkflowId }) => {
    const job = await ctx.db.get("mediaJobs", jobId);
    if (!job?.asset || job.workflowId !== parentWorkflowId || job.state !== "processing")
      throw new Error("Media job has no claimed asset");
    const asset = await ctx.db.get("mediaAssets", job.asset);
    if (!asset || asset.activeJob !== jobId) {
      throw new Error("Media job no longer owns its claimed asset");
    }

    const existing = await ctx.db
      .query("mediaEnrichments")
      .withIndex("by_asset", (q) => q.eq("asset", asset._id))
      .unique();
    if (existing) return null;
    const now = Date.now();
    const enrichmentId = await ctx.db.insert("mediaEnrichments", {
      workflowVersion: rowWorkflowVersion(job),
      asset: asset._id,
      state: "queued",
      createdAt: now,
      updatedAt: now,
    });
    const workflowId = await managedWorkflow.start(
      ctx,
      rowWorkflowVersion(job) === 2
        ? internal.media.enrichment.mediaEnrichmentV2
        : internal.media.enrichment.mediaEnrichment,
      { enrichmentId },
      {
        onComplete: internal.media.enrichment.onComplete,
        context: { enrichmentId },
      },
    );
    await ctx.db.patch("mediaEnrichments", enrichmentId, {
      workflowId,
      state: "processing",
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
    if (existing) return null;
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
    await ctx.db.insert("mediaLyricTracks", { ...value, createdAt: now });
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
    if (track.state !== "processing") {
      if (
        track.state === "ready" &&
        track.textArtifactId === args.textArtifactId &&
        track.timedArtifactId === args.timedArtifactId
      )
        return null;
      throw new Error("Generated lyrics are already settled");
    }
    await activities.publishArtifacts(ctx, args.workflowId, asset._id, {
      lyricsArtifactId: args.textArtifactId,
      timedLyricsArtifactId: args.timedArtifactId,
    });
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

export const shouldAlignLrclibLyrics = internalQuery({
  args: {
    enrichmentId: v.id("mediaEnrichments"),
    workflowId: vWorkflowId,
  },
  returns: v.boolean(),
  handler: async (ctx, { enrichmentId, workflowId }) => {
    const { asset } = await requireCurrentEnrichment(ctx, enrichmentId, workflowId);
    const track = await getLyricTrack(ctx, asset._id, "lrclib");
    return (
      track?.state === "ready" &&
      track.timing === "line" &&
      !!track.observations?.some(
        ({ value }) => value.trim() && !/^(?:\.{3}|…+)$/.test(value.trim()),
      )
    );
  },
});

export const recordAlignedLrclibLyrics = internalMutation({
  args: {
    enrichmentId: v.id("mediaEnrichments"),
    workflowId: vWorkflowId,
    timedArtifactId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { asset } = await requireCurrentEnrichment(ctx, args.enrichmentId, args.workflowId);
    const track = await getLyricTrack(ctx, asset._id, "lrclib");
    if (!track || track.state !== "ready" || track.timing !== "line") return null;
    await activities.publishArtifacts(ctx, args.workflowId, asset._id, {
      timedLyricsArtifactId: args.timedArtifactId,
    });
    await ctx.db.patch("mediaLyricTracks", track._id, {
      timing: "word",
      timedArtifactId: args.timedArtifactId,
      observations: undefined,
      suggestedOffsetMs: 0,
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
    await activities.validateProduced(ctx, args.workflowId, args.artifactId, "artifactId");
    if (asset.melodyArtifactId && asset.melodyArtifactId !== args.artifactId)
      throw new Error("Melody is already recorded");
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
    if (asset.annotationsState !== "processing") {
      if (
        asset.annotationsState === "ready" &&
        asset.annotationsArtifactId === args.annotationsArtifactId &&
        asset.midiArtifactId === args.midiArtifactId &&
        asset.musicXmlArtifactId === args.musicXmlArtifactId
      )
        return null;
      throw new Error("Annotations are already settled");
    }
    await activities.publishArtifacts(ctx, args.workflowId, asset._id, {
      annotationsArtifactId: args.annotationsArtifactId,
      midiArtifactId: args.midiArtifactId,
      musicXmlArtifactId: args.musicXmlArtifactId,
    });
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
    if (asset.annotationsState !== "processing") return null;
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
    const { asset } = await requireCurrentEnrichment(ctx, enrichmentId, workflowId);
    await ctx.db.patch(asset._id, { melodyArtifactId: undefined });
    await ctx.db.patch("mediaEnrichments", enrichmentId, {
      state: "ready",
      error: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

type InputBuilder<Definition extends ActivityDefinition, Args> = FunctionReference<
  "query",
  "internal",
  Args & { workflowId: WorkflowId },
  ActivityInput<Definition>
>;

const inputBuilders: {
  transcribe: InputBuilder<
    (typeof mediaActivities)["transcribe"],
    { enrichmentId: Id<"mediaEnrichments"> }
  >;
  alignLyrics: InputBuilder<
    (typeof mediaActivities)["alignLyrics"],
    { enrichmentId: Id<"mediaEnrichments"> }
  >;
  analyzeMelody: InputBuilder<
    (typeof mediaActivities)["analyzeMelody"],
    { enrichmentId: Id<"mediaEnrichments"> }
  >;
  assembleAnnotations: InputBuilder<
    (typeof mediaActivities)["assembleAnnotations"],
    { enrichmentId: Id<"mediaEnrichments"> }
  >;
} = {
  transcribe: internal.media.activityInputs.enrichment.transcribe,
  alignLyrics: internal.media.activityInputs.enrichment.alignLyrics,
  analyzeMelody: internal.media.activityInputs.enrichment.analyzeMelody,
  assembleAnnotations: internal.media.activityInputs.enrichment.assembleAnnotations,
};

const mediaEnrichmentDefinition = managedWorkflow.define({
  args: { enrichmentId: v.id("mediaEnrichments") },
  steps: {
    alignLyrics: activityStep(mediaActivities.alignLyrics, {
      input: inputBuilders.alignLyrics,
      label: "Align LRCLIB lyrics",
      order: 5,
    }),
    transcribe: activityStep(mediaActivities.transcribe, {
      input: inputBuilders.transcribe,
      label: "Transcribe lyrics",
      order: 6,
    }),
    analyzeMelody: activityStep(mediaActivities.analyzeMelody, {
      input: inputBuilders.analyzeMelody,
      label: "Analyze melody",
      order: 7,
    }),
    assembleAnnotations: activityStep(mediaActivities.assembleAnnotations, {
      input: inputBuilders.assembleAnnotations,
      label: "Assemble annotations",
      order: 9,
    }),
  },
});

const mediaEnrichmentHandler = mediaEnrichmentDefinition.handler(async (step, { enrichmentId }) => {
  await step.runMutation(
    internal.media.enrichment.markGeneratedLyricsProcessing,
    { enrichmentId, workflowId: step.workflowId },
    { name: "mark-generated-lyrics-processing", inline: true },
  );

  const shouldAlign = await step.runQuery(
    internal.media.enrichment.shouldAlignLrclibLyrics,
    { enrichmentId, workflowId: step.workflowId },
    { name: "prepare-lrclib-alignment", inline: true },
  );
  let transcription: ActivityOutput<(typeof mediaActivities)["transcribe"]>;
  let alignment: ActivityOutput<(typeof mediaActivities)["alignLyrics"]> | null = null;
  if (shouldAlign) {
    const outcomes = await step.parallelSettled({
      transcription: step.steps.transcribe.run({ enrichmentId }),
      alignment: step.steps.alignLyrics.run({ enrichmentId }),
    });
    if (outcomes.transcription.status === "rejected") {
      throw outcomes.transcription.reason;
    }
    transcription = outcomes.transcription.value;
    if (outcomes.alignment.status === "fulfilled") {
      alignment = outcomes.alignment.value;
    } else {
      console.warn("[lrclib] Unable to align lyrics", {
        enrichmentId,
        error:
          outcomes.alignment.reason instanceof Error
            ? outcomes.alignment.reason.message
            : String(outcomes.alignment.reason),
      });
    }
  } else {
    await step.steps.alignLyrics.skip("No line-timed lyrics required alignment");
    transcription = await step.steps.transcribe.run({ enrichmentId });
  }

  await step.runMutation(
    internal.media.enrichment.recordGeneratedLyrics,
    {
      enrichmentId,
      workflowId: step.workflowId,
      textArtifactId: transcription.lyricsArtifactId,
      timedArtifactId: transcription.timedLyricsArtifactId,
    },
    { name: "record-generated-lyrics", inline: true },
  );
  if (alignment) {
    await step.runMutation(
      internal.media.enrichment.recordAlignedLrclibLyrics,
      {
        enrichmentId,
        workflowId: step.workflowId,
        timedArtifactId: alignment.timedLyricsArtifactId,
      },
      { name: "record-aligned-lrclib-lyrics", inline: true },
    );
  }

  let hasMelody = false;
  try {
    const melody = await step.steps.analyzeMelody.run({ enrichmentId });
    await step.runMutation(
      internal.media.enrichment.recordMelody,
      { enrichmentId, workflowId: step.workflowId, artifactId: melody.artifactId },
      { name: "record-melody", inline: true },
    );
    hasMelody = true;
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
  }

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
      const annotations = await step.steps.assembleAnnotations.run({ enrichmentId });
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
  } else {
    await step.steps.assembleAnnotations.skip("Melody analysis was unavailable");
  }

  await step.runMutation(
    internal.media.enrichment.complete,
    { enrichmentId, workflowId: step.workflowId },
    { name: "complete-enrichment", inline: true },
  );
});

// Keep the original export forever while v1 journals can still reference it.
export const mediaEnrichment = mediaEnrichmentHandler;
export const mediaEnrichmentV1 = mediaEnrichmentHandler;
export const mediaEnrichmentV2 = mediaEnrichmentHandler;

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
