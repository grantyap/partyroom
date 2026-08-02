import type { WorkflowId } from "@convex-dev/workflow";
import { type ArtifactId } from "@partyroom/activities";
import { mediaActivities } from "@partyroom/media-activities";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { env, type QueryCtx } from "../../_generated/server";
import { defineActivityInput } from "../../activities/defineActivityInput";
import { activities } from "../../activities/workflowManager";
import { getLyricTrack } from "../domain/lyrics";
import { replaceUrlOrigin } from "../urls";

async function artifactUrl(
  ctx: Parameters<typeof activities.getArtifactUrl>[0],
  artifactId: string | undefined,
) {
  const url = artifactId ? await activities.getArtifactUrl(ctx, artifactId as ArtifactId) : null;
  if (!url) throw new Error("Media artifact does not exist");
  return replaceUrlOrigin(url, env.WORKER_CONVEX_CLOUD_ORIGIN);
}

async function requireCurrentEnrichment(
  ctx: QueryCtx,
  enrichmentId: Id<"mediaEnrichments">,
  workflowId: WorkflowId,
) {
  const enrichment = await ctx.db.get("mediaEnrichments", enrichmentId);
  if (!enrichment || enrichment.workflowId !== workflowId) {
    throw new Error("Media enrichment workflow is no longer current");
  }
  const asset = await ctx.db.get("mediaAssets", enrichment.asset);
  if (!asset) throw new Error("Media enrichment references a missing asset");
  return { enrichment, asset };
}

export const transcribe = defineActivityInput({
  activity: mediaActivities.transcribe,
  args: { enrichmentId: v.id("mediaEnrichments") },
  handler: async (ctx, { enrichmentId, workflowId }) => {
    const { asset } = await requireCurrentEnrichment(ctx, enrichmentId, workflowId);
    return {
      audioUrl: await artifactUrl(ctx, asset.vocalsArtifactId),
    };
  },
});

export const analyzeMelody = defineActivityInput({
  activity: mediaActivities.analyzeMelody,
  args: { enrichmentId: v.id("mediaEnrichments") },
  handler: async (ctx, { enrichmentId, workflowId }) => {
    const { asset } = await requireCurrentEnrichment(ctx, enrichmentId, workflowId);
    return {
      audioUrl: await artifactUrl(ctx, asset.vocalsArtifactId),
    };
  },
});

export const alignLyrics = defineActivityInput({
  activity: mediaActivities.alignLyrics,
  args: { enrichmentId: v.id("mediaEnrichments") },
  handler: async (ctx, { enrichmentId, workflowId }) => {
    const { asset } = await requireCurrentEnrichment(ctx, enrichmentId, workflowId);
    const lyrics = await getLyricTrack(ctx, asset._id, "lrclib");
    return {
      audioUrl: await artifactUrl(ctx, asset.vocalsArtifactId),
      transcript: (lyrics?.observations ?? [])
        .map(({ value }) => value.trim())
        .filter((value) => value && !/^(?:\.{3}|…+)$/.test(value))
        .join("\n"),
    };
  },
});

export const assembleAnnotations = defineActivityInput({
  activity: mediaActivities.assembleAnnotations,
  args: { enrichmentId: v.id("mediaEnrichments") },
  handler: async (ctx, { enrichmentId, workflowId }) => {
    const { asset } = await requireCurrentEnrichment(ctx, enrichmentId, workflowId);
    const lyrics = await getLyricTrack(ctx, asset._id, "generated");
    return {
      lyricsUrl: await artifactUrl(ctx, lyrics?.timedArtifactId),
      melodyUrl: await artifactUrl(ctx, asset.melodyArtifactId),
      duration: asset.duration!,
      extractor: asset.extractor,
      sourceId: asset.sourceId,
      title: asset.title,
    };
  },
});
