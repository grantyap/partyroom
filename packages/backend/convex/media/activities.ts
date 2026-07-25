import { ActivityManager, type ArtifactId, type ArtifactScopeId } from "@partyroom/activities";
import { mediaActivities } from "@partyroom/media-activities";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { components, internal } from "../_generated/api";
import { env, internalMutation } from "../_generated/server";
import { mediaOperationKind } from "./validators";
import { replaceUrlOrigin } from "./urls";
import { getActivityJobState, recordScheduledActivity } from "./service";

const manager = new ActivityManager(components.activities);

async function artifactUrl(
  ctx: Parameters<typeof manager.getArtifactUrl>[0] & {
    storage: { getUrl(id: Id<"_storage">): Promise<string | null> };
  },
  artifactId: string | undefined,
  storageId: Id<"_storage"> | undefined,
) {
  const url = artifactId
    ? await manager.getArtifactUrl(ctx, artifactId as ArtifactId)
    : storageId
      ? await ctx.storage.getUrl(storageId)
      : null;
  if (!url) throw new Error("Media artifact does not exist");
  return replaceUrlOrigin(url, env.WORKER_CONVEX_CLOUD_ORIGIN);
}

export const schedule = internalMutation({
  args: {
    jobId: v.id("mediaJobs"),
    workflowId: v.string(),
    artifactScopeId: v.string(),
    kind: mediaOperationKind,
  },
  returns: v.string(),
  handler: async (ctx, { jobId, workflowId, artifactScopeId, kind }): Promise<string> => {
    const { job, asset } = await getActivityJobState(ctx, jobId, kind);
    const requireAsset = () => {
      if (!asset) throw new Error("Media job has no claimed asset");
      return asset;
    };

    const input =
      kind === "resolve" || kind === "download"
        ? { jobId }
        : kind === "extractAudio"
          ? {
              sourceUrl: await artifactUrl(
                ctx,
                requireAsset().sourceArtifactId,
                requireAsset().sourceStorageId,
              ),
            }
          : kind === "separate" || kind === "transcribe" || kind === "analyzeMelody"
            ? {
                audioUrl: await artifactUrl(
                  ctx,
                  kind === "separate"
                    ? requireAsset().extractedAudioArtifactId
                    : requireAsset().vocalsArtifactId,
                  kind === "separate"
                    ? requireAsset().extractedAudioStorageId
                    : requireAsset().vocalsStorageId,
                ),
              }
            : kind === "mux"
              ? {
                  videoUrl: await artifactUrl(
                    ctx,
                    requireAsset().sourceArtifactId,
                    requireAsset().sourceStorageId,
                  ),
                  instrumentalUrl: await artifactUrl(
                    ctx,
                    requireAsset().instrumentalArtifactId,
                    requireAsset().instrumentalStorageId,
                  ),
                }
              : {
                  lyricsUrl: await artifactUrl(
                    ctx,
                    requireAsset().timedLyricsArtifactId,
                    requireAsset().timedLyricsStorageId,
                  ),
                  melodyUrl: await artifactUrl(
                    ctx,
                    requireAsset().melodyArtifactId,
                    requireAsset().melodyStorageId,
                  ),
                  duration: requireAsset().duration!,
                  extractor: requireAsset().extractor,
                  sourceId: requireAsset().sourceId,
                  title: requireAsset().title,
                };

    const definition = mediaActivities[kind];
    if (job.artifactScopeId && job.artifactScopeId !== artifactScopeId) {
      throw new Error("Workflow artifact scope does not match the media job");
    }
    if (!job.artifactScopeId) {
      await ctx.db.patch("mediaJobs", jobId, {
        artifactScopeId,
        updatedAt: Date.now(),
      });
    }
    const activityId: string = await manager.schedule(ctx, definition as any, input as any, {
      onComplete: internal.media.activityCompletion.onComplete as any,
      context: { jobId, workflowId, kind },
      artifactScopeId: artifactScopeId as ArtifactScopeId,
    });
    await recordScheduledActivity(ctx, {
      jobId,
      activityId,
      kind,
    });
    return activityId;
  },
});
