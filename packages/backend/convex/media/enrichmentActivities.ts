import { type ArtifactId } from "@partyroom/activities";
import { vWorkflowId } from "@convex-dev/workflow";
import { mediaActivities } from "@partyroom/media-activities";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { env, internalMutation } from "../_generated/server";
import { activities } from "../activities/workflowManager";
import { getLyricTrack } from "./service";
import { replaceUrlOrigin } from "./urls";

const enrichmentOperationKind = v.union(
  v.literal("transcribe"),
  v.literal("analyzeMelody"),
  v.literal("assembleAnnotations"),
);

async function artifactUrl(
  ctx: Parameters<typeof activities.getArtifactUrl>[0],
  artifactId: string | undefined,
) {
  const url = artifactId ? await activities.getArtifactUrl(ctx, artifactId as ArtifactId) : null;
  if (!url) throw new Error("Media artifact does not exist");
  return replaceUrlOrigin(url, env.WORKER_CONVEX_CLOUD_ORIGIN);
}

export const schedule = internalMutation({
  args: {
    enrichmentId: v.id("mediaEnrichments"),
    workflowId: vWorkflowId,
    kind: enrichmentOperationKind,
  },
  returns: v.string(),
  handler: async (ctx, { enrichmentId, workflowId, kind }) => {
    const enrichment = await ctx.db.get("mediaEnrichments", enrichmentId);
    if (!enrichment || enrichment.workflowId !== workflowId) {
      throw new Error("Media enrichment workflow is no longer current");
    }
    const asset = await ctx.db.get("mediaAssets", enrichment.asset);
    if (!asset) throw new Error("Media enrichment references a missing asset");
    const generatedLyrics =
      kind === "assembleAnnotations" ? await getLyricTrack(ctx, asset._id, "generated") : null;
    const input =
      kind === "assembleAnnotations"
        ? {
            lyricsUrl: await artifactUrl(ctx, generatedLyrics?.timedArtifactId),
            melodyUrl: await artifactUrl(ctx, asset.melodyArtifactId),
            duration: asset.duration!,
            extractor: asset.extractor,
            sourceId: asset.sourceId,
            title: asset.title,
          }
        : {
            audioUrl: await artifactUrl(ctx, asset.vocalsArtifactId),
          };
    const activityId: string = await activities.schedule(
      ctx,
      workflowId,
      mediaActivities[kind] as any,
      input as any,
      {
        onComplete: internal.media.enrichmentActivityCompletion.onComplete as any,
        context: { enrichmentId },
      },
    );
    await ctx.db.patch("mediaEnrichments", enrichmentId, {
      activeActivities: [...(enrichment.activeActivities ?? []), { activityId, kind }],
      updatedAt: Date.now(),
    });
    return activityId;
  },
});
