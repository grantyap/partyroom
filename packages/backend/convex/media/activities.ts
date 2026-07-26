import { ActivityManager, type ArtifactId } from "@partyroom/activities";
import { vWorkflowId } from "@convex-dev/workflow";
import { mediaActivities } from "@partyroom/media-activities";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { env, internalMutation } from "../_generated/server";
import { mediaOperationKind } from "./validators";
import { replaceUrlOrigin } from "./urls";
import { getActivityJobState, recordScheduledActivity } from "./service";

const manager = new ActivityManager(components.activities);

async function artifactUrl(
  ctx: Parameters<typeof manager.getArtifactUrl>[0],
  artifactId: string | undefined,
) {
  const url = artifactId ? await manager.getArtifactUrl(ctx, artifactId as ArtifactId) : null;
  if (!url) throw new Error("Media artifact does not exist");
  return replaceUrlOrigin(url, env.WORKER_CONVEX_CLOUD_ORIGIN);
}

export const schedule = internalMutation({
  args: {
    jobId: v.id("mediaJobs"),
    workflowId: vWorkflowId,
    kind: mediaOperationKind,
  },
  returns: v.string(),
  handler: async (ctx, { jobId, workflowId, kind }): Promise<string> => {
    const { asset } = await getActivityJobState(ctx, jobId, kind);
    const requireAsset = () => {
      if (!asset) throw new Error("Media job has no claimed asset");
      return asset;
    };

    const input =
      kind === "resolve" || kind === "download"
        ? { jobId }
        : kind === "extractAudio"
          ? {
              sourceUrl: await artifactUrl(ctx, requireAsset().sourceArtifactId),
            }
          : kind === "separate" || kind === "transcribe" || kind === "analyzeMelody"
            ? {
                audioUrl: await artifactUrl(
                  ctx,
                  kind === "separate"
                    ? requireAsset().extractedAudioArtifactId
                    : requireAsset().vocalsArtifactId,
                ),
              }
            : kind === "mux"
              ? {
                  videoUrl: await artifactUrl(ctx, requireAsset().sourceArtifactId),
                  instrumentalUrl: await artifactUrl(ctx, requireAsset().instrumentalArtifactId),
                }
              : {
                  lyricsUrl: await artifactUrl(ctx, requireAsset().timedLyricsArtifactId),
                  melodyUrl: await artifactUrl(ctx, requireAsset().melodyArtifactId),
                  duration: requireAsset().duration!,
                  extractor: requireAsset().extractor,
                  sourceId: requireAsset().sourceId,
                  title: requireAsset().title,
                };

    const definition = mediaActivities[kind];
    const activityId: string = await manager.scheduleForWorkflow(
      ctx,
      workflowId,
      definition as any,
      input as any,
      {
        onComplete: internal.media.activityCompletion.onComplete as any,
        context: { jobId, workflowId, kind },
      },
    );
    await recordScheduledActivity(ctx, {
      jobId,
      activityId,
      kind,
    });
    return activityId;
  },
});
