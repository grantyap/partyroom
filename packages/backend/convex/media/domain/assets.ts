import type { WorkflowId } from "@convex-dev/workflow";
import { type ArtifactId } from "@partyroom/activities";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { activities, cancelWorkflow, managedWorkflow } from "../../activities/workflowManager";

export const assetArtifactFields = [
  "sourceArtifactId",
  "extractedAudioArtifactId",
  "instrumentalArtifactId",
  "vocalsArtifactId",
  "finalArtifactId",
  "melodyArtifactId",
  "annotationsArtifactId",
  "midiArtifactId",
  "musicXmlArtifactId",
] as const satisfies readonly (keyof Doc<"mediaAssets">)[];

export async function getMediaEnrichment(ctx: Pick<QueryCtx, "db">, assetId: Id<"mediaAssets">) {
  return await ctx.db
    .query("mediaEnrichments")
    .withIndex("by_asset", (q) => q.eq("asset", assetId))
    .unique();
}

export async function cancelAssetEnrichment(ctx: MutationCtx, assetId: Id<"mediaAssets">) {
  const enrichment = await getMediaEnrichment(ctx, assetId);
  if (!enrichment || enrichment.state !== "processing") return enrichment;
  if (enrichment.workflowId) {
    try {
      await managedWorkflow.cancelActivities(ctx, enrichment.workflowId as WorkflowId);
      await cancelWorkflow(ctx, enrichment.workflowId as WorkflowId);
    } catch (error) {
      console.warn(`Unable to cancel media enrichment ${enrichment.workflowId}`, error);
    }
  }
  for (const activity of enrichment.activeActivities ?? []) {
    await activities.cancel(ctx, activity.activityId as any);
  }
  return enrichment;
}

export async function deleteAssetEnrichment(ctx: MutationCtx, assetId: Id<"mediaAssets">) {
  const enrichment = await cancelAssetEnrichment(ctx, assetId);
  if (enrichment) await ctx.db.delete("mediaEnrichments", enrichment._id);
}

export async function deleteAssetArtifacts(ctx: MutationCtx, asset: Doc<"mediaAssets">) {
  let deleted = 0;
  for (const field of assetArtifactFields) {
    const artifactId = asset[field];
    if (!artifactId) continue;
    if (await activities.deleteArtifact(ctx, artifactId as ArtifactId)) {
      deleted += 1;
    }
  }
  return deleted;
}

export async function deleteLyricTracks(ctx: MutationCtx, assetId: Id<"mediaAssets">) {
  const tracks = await ctx.db
    .query("mediaLyricTracks")
    .withIndex("by_asset", (q) => q.eq("asset", assetId))
    .take(100);
  let deletedArtifacts = 0;
  for (const track of tracks) {
    for (const artifactId of [track.textArtifactId, track.timedArtifactId]) {
      if (artifactId && (await activities.deleteArtifact(ctx, artifactId as ArtifactId))) {
        deletedArtifacts += 1;
      }
    }
    await ctx.db.delete("mediaLyricTracks", track._id);
  }
  return deletedArtifacts;
}

export async function deleteIncompleteAsset(ctx: MutationCtx, asset: Doc<"mediaAssets">) {
  await deleteAssetEnrichment(ctx, asset._id);
  await deleteLyricTracks(ctx, asset._id);
  await deleteAssetArtifacts(ctx, asset);
  await ctx.db.delete(asset._id);
}
