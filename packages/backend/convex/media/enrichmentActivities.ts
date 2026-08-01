import { type ArtifactId } from "@partyroom/activities";
import { vWorkflowId } from "@convex-dev/workflow";
import { mediaActivities } from "@partyroom/media-activities";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { env, internalMutation } from "../_generated/server";
import { activities } from "../activities/workflowManager";
import { getLyricTrack } from "./service";
import { replaceUrlOrigin } from "./urls";
import { mediaEnrichmentOperationKind } from "./validators";

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
    kind: mediaEnrichmentOperationKind,
    language: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, { enrichmentId, workflowId, kind, language }) => {
    const enrichment = await ctx.db.get("mediaEnrichments", enrichmentId);
    if (!enrichment || enrichment.workflowId !== workflowId) {
      throw new Error("Media enrichment workflow is no longer current");
    }
    const asset = await ctx.db.get("mediaAssets", enrichment.asset);
    if (!asset) throw new Error("Media enrichment references a missing asset");
    if (kind === "alignLyrics" && !language) {
      throw new Error("Lyrics alignment requires a detected language");
    }
    const [generatedLyrics, lrclibLyrics] = await Promise.all([
      kind === "assembleAnnotations" ? getLyricTrack(ctx, asset._id, "generated") : null,
      kind === "alignLyrics" ? getLyricTrack(ctx, asset._id, "lrclib") : null,
    ]);
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
        : kind === "alignLyrics"
          ? {
              audioUrl: await artifactUrl(ctx, asset.vocalsArtifactId),
              lyrics: (lrclibLyrics?.observations ?? [])
                .map(({ value }) => value.trim())
                .filter((value) => value && !/^(?:\.{3}|…+)$/.test(value))
                .join("\n"),
              language: language!,
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
