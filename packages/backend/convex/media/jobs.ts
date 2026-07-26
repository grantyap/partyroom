import { v } from "convex/values";
import { vWorkflowId } from "@convex-dev/workflow";
import { ActivityManager, type ArtifactId } from "@partyroom/activities";
import type { Id } from "../_generated/dataModel";
import { components, internal } from "../_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "../_generated/server";
import { managedWorkflow } from "../activities/workflowManager";
import { getCurrentUserImpl } from "../auth";
import { userHasRoomPermission } from "../rooms";
import { mediaPipelineProgress } from "./progress";
import {
  attachWorkflowToJob,
  claimAssetForJob,
  completeJobFromAsset,
  createOrJoinMedia,
  deleteCompletedMediaAsset,
  failMediaJob,
  finalizeAssetForJob,
  markJobAnnotationsFailed,
  recordStageResultForJob,
  removeRoomMedia,
} from "./service";
import { mediaOperationKind, type OperationKind } from "./validators";

const activityManager = new ActivityManager(components.activities);

async function mediaArtifactUrl(ctx: QueryCtx, artifactId: string | undefined) {
  return artifactId ? await activityManager.getArtifactUrl(ctx, artifactId as ArtifactId) : null;
}

export { removeRoomMedia as removeFromRoomImpl } from "./service";

async function activityStatuses(
  ctx: Pick<QueryCtx, "runQuery">,
  activities: Array<{ activityId: string; kind: OperationKind }> | undefined,
) {
  return await Promise.all(
    (activities ?? []).map(async (entry) => {
      const status = await ctx.runQuery(components.activities.activities.get, {
        activityId: entry.activityId as any,
      });
      return {
        ...entry,
        state: status?.state ?? "scheduled",
        attempt: status?.attempt ?? 0,
        progress: status?.progress,
        message: status?.progressMessage,
      };
    }),
  );
}

async function requireRoomAccess(
  ctx: Parameters<typeof getCurrentUserImpl>[0],
  roomId: Id<"rooms">,
) {
  const user = await getCurrentUserImpl(ctx);
  if (!user) throw new Error("Unauthenticated");
  const room = await ctx.db.get("rooms", roomId);
  if (!room) throw new Error("Room not found");
  const roomMember = await ctx.db
    .query("roomMembers")
    .withIndex("by_room_user", (q) => q.eq("room", roomId).eq("user", user._id))
    .first();
  if (
    !userHasRoomPermission({
      user: user._id,
      room,
      roomMember,
      permission: "rooms:read",
    })
  ) {
    throw new Error("User not in room");
  }
  return user._id;
}

export const authorizeRequest = internalQuery({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => await requireRoomAccess(ctx, roomId),
});

export const getEncryptedSource = internalQuery({
  args: { jobId: v.id("mediaJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("mediaJobs", jobId);
    if (!job) throw new Error("Media job not found");
    return { encryptedSource: job.encryptedSource, sourceIv: job.sourceIv };
  },
});

export const createOrJoin = internalMutation({
  args: {
    roomId: v.id("rooms"),
    requestedBy: v.string(),
    requestKey: v.string(),
    encryptedSource: v.string(),
    sourceIv: v.string(),
  },
  handler: createOrJoinMedia,
});

export const request = internalMutation({
  args: {
    roomId: v.id("rooms"),
    requestedBy: v.string(),
    requestKey: v.string(),
    encryptedSource: v.string(),
    sourceIv: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await createOrJoinMedia(ctx, args);
    if (!result.created) return result;
    const workflowId = await managedWorkflow.start(
      ctx,
      internal.media.pipeline.mediaPipeline,
      { jobId: result.jobId },
      {
        onComplete: internal.media.pipeline.onPipelineComplete,
        context: { jobId: result.jobId },
      },
    );
    await attachWorkflowToJob(ctx, result.jobId, workflowId);
    return result;
  },
});

export const attachWorkflow = internalMutation({
  args: { jobId: v.id("mediaJobs"), workflowId: vWorkflowId },
  handler: async (ctx, { jobId, workflowId }) => await attachWorkflowToJob(ctx, jobId, workflowId),
});

export const removeFromRoom = mutation({
  args: { roomId: v.id("rooms"), roomMediaId: v.id("roomMedia") },
  handler: async (ctx, args) => {
    await requireRoomAccess(ctx, args.roomId);
    await removeRoomMedia(ctx, args);
  },
});

export const deleteCompletedAsset = internalMutation({
  args: { assetId: v.id("mediaAssets") },
  returns: v.object({
    deletedJobs: v.number(),
    deletedRoomMedia: v.number(),
    deletedStorageObjects: v.number(),
  }),
  handler: async (ctx, { assetId }) => await deleteCompletedMediaAsset(ctx, assetId),
});

export const claimAsset = internalMutation({
  args: {
    jobId: v.id("mediaJobs"),
    extractor: v.string(),
    sourceId: v.string(),
    title: v.optional(v.string()),
    duration: v.optional(v.number()),
  },
  handler: claimAssetForJob,
});

export const recordStageResult = internalMutation({
  args: {
    jobId: v.id("mediaJobs"),
    kind: mediaOperationKind,
    artifactId: v.string(),
    secondaryArtifactId: v.optional(v.string()),
    tertiaryArtifactId: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    await recordStageResultForJob(ctx, {
      ...args,
      artifactId: args.artifactId as ArtifactId,
      secondaryArtifactId: args.secondaryArtifactId as ArtifactId | undefined,
      tertiaryArtifactId: args.tertiaryArtifactId as ArtifactId | undefined,
    }),
});

export const markAnnotationsFailed = internalMutation({
  args: { jobId: v.id("mediaJobs"), errorMessage: v.string() },
  handler: async (ctx, { jobId, errorMessage }) =>
    await markJobAnnotationsFailed(ctx, jobId, errorMessage),
});

export const completeFromAsset = internalMutation({
  args: { jobId: v.id("mediaJobs"), assetId: v.id("mediaAssets") },
  handler: async (ctx, { jobId, assetId }) => await completeJobFromAsset(ctx, jobId, assetId),
});

export const finalizeAsset = internalMutation({
  args: { jobId: v.id("mediaJobs") },
  handler: async (ctx, { jobId }) => await finalizeAssetForJob(ctx, jobId),
});

export const failJob = internalMutation({
  args: {
    jobId: v.id("mediaJobs"),
    errorCode: v.string(),
    errorMessage: v.string(),
  },
  handler: failMediaJob,
});

export const getJob = query({
  args: { roomId: v.id("rooms"), jobId: v.id("mediaJobs") },
  handler: async (ctx, { roomId, jobId }) => {
    await requireRoomAccess(ctx, roomId);
    const association = await ctx.db
      .query("roomMedia")
      .withIndex("by_room_job", (q) => q.eq("room", roomId).eq("job", jobId))
      .first();
    if (!association) throw new Error("Media job is not attached to this room");
    const job = await ctx.db.get("mediaJobs", jobId);
    if (!job) throw new Error("Media job not found");
    const asset = job.asset ? await ctx.db.get("mediaAssets", job.asset) : null;
    const activities = await activityStatuses(ctx, job.activeActivities);
    return {
      _id: job._id,
      state: job.state,
      stage: job.stage,
      progress: mediaPipelineProgress({
        jobState: job.state,
        hasAsset: !!job.asset,
        asset,
        activities,
      }),
      activities,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      asset: asset
        ? {
            _id: asset._id,
            title: asset.title,
            duration: asset.duration,
            finalArtifactId: asset.finalArtifactId,
            lyricsArtifactId: asset.lyricsArtifactId,
            annotationsArtifactId: asset.annotationsArtifactId,
            midiArtifactId: asset.midiArtifactId,
            musicXmlArtifactId: asset.musicXmlArtifactId,
            annotationsState: asset.annotationsState,
            annotationsError: asset.annotationsError,
          }
        : null,
    };
  },
});

export const listRoomMedia = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    await requireRoomAccess(ctx, roomId);
    const associations = await ctx.db
      .query("roomMedia")
      .withIndex("by_room", (q) => q.eq("room", roomId))
      .order("desc")
      .take(20);

    return await Promise.all(
      associations.map(async (association) => {
        const job = await ctx.db.get("mediaJobs", association.job);
        const assetId = association.asset ?? job?.asset;
        const asset = assetId ? await ctx.db.get("mediaAssets", assetId) : null;
        const activities = await activityStatuses(ctx, job?.activeActivities);
        return {
          _id: association._id,
          jobId: association.job,
          state: job?.state ?? "failed",
          stage: job?.stage ?? "failed",
          progress: job
            ? mediaPipelineProgress({
                jobState: job.state,
                hasAsset: !!job.asset,
                asset,
                activities,
              })
            : 0,
          activities,
          title: asset?.title,
          duration: asset?.duration,
          errorMessage: job?.errorMessage,
          sourceUrl: asset ? await mediaArtifactUrl(ctx, asset.sourceArtifactId) : null,
          instrumentalUrl: asset ? await mediaArtifactUrl(ctx, asset.instrumentalArtifactId) : null,
          finalUrl: asset ? await mediaArtifactUrl(ctx, asset.finalArtifactId) : null,
          lyricsUrl: asset ? await mediaArtifactUrl(ctx, asset.lyricsArtifactId) : null,
          timedLyricsUrl: asset ? await mediaArtifactUrl(ctx, asset.timedLyricsArtifactId) : null,
          annotationsUrl: asset ? await mediaArtifactUrl(ctx, asset.annotationsArtifactId) : null,
          midiUrl: asset ? await mediaArtifactUrl(ctx, asset.midiArtifactId) : null,
          musicXmlUrl: asset ? await mediaArtifactUrl(ctx, asset.musicXmlArtifactId) : null,
          annotationsState: asset?.annotationsState ?? "failed",
          annotationsError: asset?.annotationsError,
          createdAt: association.createdAt,
        };
      }),
    );
  },
});
