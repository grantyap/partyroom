import type { WorkflowId } from "@convex-dev/workflow";
import { type ArtifactId } from "@partyroom/activities";
import { mediaActivities } from "@partyroom/media-activities";
import { v } from "convex/values";
import { env, type QueryCtx } from "../../_generated/server";
import { defineActivityInput } from "../../activities/defineActivityInput";
import { activities } from "../../activities/workflowManager";
import { getActivityJobState } from "../domain/jobs";
import { replaceUrlOrigin } from "../urls";
import type { CoreMediaOperationKind } from "../validators";

async function artifactUrl(
  ctx: Parameters<typeof activities.getArtifactUrl>[0],
  artifactId: string | undefined,
) {
  const url = artifactId ? await activities.getArtifactUrl(ctx, artifactId as ArtifactId) : null;
  if (!url) throw new Error("Media artifact does not exist");
  return replaceUrlOrigin(url, env.WORKER_CONVEX_CLOUD_ORIGIN);
}

async function requireCurrentJob(
  ctx: QueryCtx,
  jobId: Parameters<typeof getActivityJobState>[1],
  workflowId: WorkflowId,
  kind: CoreMediaOperationKind,
) {
  const state = await getActivityJobState(ctx, jobId, kind);
  if (state.job.workflowId !== workflowId) {
    throw new Error("Media workflow is no longer current");
  }
  return state;
}

export const resolve = defineActivityInput({
  activity: mediaActivities.resolve,
  args: { jobId: v.id("mediaJobs") },
  handler: async (ctx, { jobId, workflowId }) => {
    await requireCurrentJob(ctx, jobId, workflowId, "resolve");
    return { jobId };
  },
});

export const download = defineActivityInput({
  activity: mediaActivities.download,
  args: { jobId: v.id("mediaJobs") },
  handler: async (ctx, { jobId, workflowId }) => {
    await requireCurrentJob(ctx, jobId, workflowId, "download");
    return { jobId };
  },
});

export const extractAudio = defineActivityInput({
  activity: mediaActivities.extractAudio,
  args: { jobId: v.id("mediaJobs") },
  handler: async (ctx, { jobId, workflowId }) => {
    const { asset } = await requireCurrentJob(ctx, jobId, workflowId, "extractAudio");
    if (!asset) throw new Error("Media job has no claimed asset");
    return {
      sourceUrl: await artifactUrl(ctx, asset.sourceArtifactId),
    };
  },
});

export const separate = defineActivityInput({
  activity: mediaActivities.separate,
  args: { jobId: v.id("mediaJobs") },
  handler: async (ctx, { jobId, workflowId }) => {
    const { asset } = await requireCurrentJob(ctx, jobId, workflowId, "separate");
    if (!asset) throw new Error("Media job has no claimed asset");
    return {
      audioUrl: await artifactUrl(ctx, asset.extractedAudioArtifactId),
    };
  },
});

export const mux = defineActivityInput({
  activity: mediaActivities.mux,
  args: { jobId: v.id("mediaJobs") },
  handler: async (ctx, { jobId, workflowId }) => {
    const { asset } = await requireCurrentJob(ctx, jobId, workflowId, "mux");
    if (!asset) throw new Error("Media job has no claimed asset");
    return {
      videoUrl: await artifactUrl(ctx, asset.sourceArtifactId),
      instrumentalUrl: await artifactUrl(ctx, asset.instrumentalArtifactId),
    };
  },
});
