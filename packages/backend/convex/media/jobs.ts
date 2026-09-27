import { v } from "convex/values";
import { vWorkflowId, type WorkflowId } from "@convex-dev/workflow";
import { type ArtifactId } from "@partyroom/activities";
import type { Doc, Id } from "../_generated/dataModel";
import { components, internal } from "../_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { activities, managedWorkflow } from "../activities/workflowManager";
import { capabilities } from "../capabilities";
import { enqueueRoomMedia } from "../playback";
import { requireRoomAction } from "../rooms";
import { getMediaEnrichment } from "./domain/assets";
import {
  attachWorkflowToJob,
  claimAssetForJob,
  completeJobFromAsset,
  createOrJoinMedia,
  deleteCompletedMediaAsset,
  failMediaJob,
  finalizeAssetForJob,
  recordStageResultForJob,
  queueReprocessDuringDrain,
  requeueRoomMedia,
  removeRoomMedia,
} from "./domain/jobs";
import { getLyricTrack } from "./domain/lyrics";
import { isDraining } from "../migration/drain";
import { workflowVersion } from "../migration/workflowRouting";
import { workflowPipelineStepStatuses } from "./progress/model";
import { stageResult, lrclibResult } from "./validators";

async function mediaArtifactUrl(ctx: QueryCtx, artifactId: string | undefined) {
  return artifactId ? await activities.getArtifactUrl(ctx, artifactId as ArtifactId) : null;
}

export { removeRoomMedia as removeFromRoomImpl } from "./domain/jobs";

async function workflowProgressSteps(
  ctx: Pick<QueryCtx, "runQuery">,
  workflowIds: Array<string | null | undefined>,
) {
  const workflows = await Promise.all(
    workflowIds
      .filter((workflowId): workflowId is string => typeof workflowId === "string")
      .map(async (workflowId) => await managedWorkflow.getProgress(ctx, workflowId as WorkflowId)),
  );
  return workflowPipelineStepStatuses(...workflows);
}

async function requireRoomAccess(ctx: QueryCtx, roomId: Id<"rooms">) {
  const { user } = await requireRoomAction(ctx, roomId, capabilities.rooms.read);
  return user._id;
}

export const authorizeRequest = internalQuery({
  args: { roomId: v.id("rooms") },
  returns: v.string(),
  handler: async (ctx, { roomId }) => {
    const { user } = await requireRoomAction(ctx, roomId, capabilities.rooms.addToQueue);
    return user._id;
  },
});

export const getEncryptedSource = internalQuery({
  args: { attemptToken: v.string() },
  returns: v.object({ encryptedSource: v.string(), sourceIv: v.string() }),
  handler: async (ctx, args) => {
    const attempt = await ctx.runQuery(components.activities.activities.getAttemptInput, args);
    if (attempt.activityType !== "media.resolve" && attempt.activityType !== "media.download")
      throw new Error("Activity cannot read media sources");
    const jobId = ctx.db.normalizeId("mediaJobs", attempt.input.jobId);
    if (!jobId) throw new Error("Invalid source job");
    const job = await requireRun(ctx, jobId, attempt.workflowId);
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
  returns: v.object({
    jobId: v.id("mediaJobs"),
    roomMediaId: v.id("roomMedia"),
    created: v.boolean(),
    workflowVersion: v.union(v.literal(1), v.literal(2)),
  }),
  handler: async (ctx, args) => {
    const result = await createOrJoinMedia(ctx, args);
    if (result.created && !isDraining()) {
      const workflowId = await managedWorkflow.start(
        ctx,
        result.workflowVersion === 2
          ? internal.media.pipeline.mediaPipelineV2
          : internal.media.pipeline.mediaPipeline,
        { jobId: result.jobId },
        {
          onComplete: internal.media.pipeline.onPipelineComplete,
          context: { jobId: result.jobId },
        },
      );
      await attachWorkflowToJob(ctx, result.jobId, workflowId);
    }
    await enqueueRoomMedia(ctx, {
      roomId: args.roomId,
      roomMediaId: result.roomMediaId,
      addedBy: args.requestedBy,
    });
    return result;
  },
});

export const attachWorkflow = internalMutation({
  args: { jobId: v.id("mediaJobs"), workflowId: vWorkflowId },
  handler: async (ctx, { jobId, workflowId }) => await attachWorkflowToJob(ctx, jobId, workflowId),
});

export const removeFromRoom = mutation({
  args: { roomId: v.id("rooms"), roomMediaId: v.id("roomMedia") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRoomAccess(ctx, args.roomId);
    const playback = await ctx.db
      .query("roomPlayback")
      .withIndex("by_room", (q) => q.eq("room", args.roomId))
      .unique();
    if (!playback) throw new Error("Room playback state not found");
    const current =
      playback.state.kind === "occupiedPlaying" || playback.state.kind === "occupiedPaused"
        ? playback.state.current
        : playback.state.kind === "empty" && playback.state.transport.kind !== "idle"
          ? playback.state.transport.current
          : null;
    if (
      current?.roomMedia === args.roomMediaId ||
      playback.state.queue.some((item) => item.roomMedia === args.roomMediaId)
    ) {
      throw new Error("Remove this media from playback first");
    }
    await removeRoomMedia(ctx, args);
    return null;
  },
});

export const reprocess = mutation({
  args: { roomId: v.id("rooms"), roomMediaId: v.id("roomMedia") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRoomAccess(ctx, args.roomId);
    const draining = isDraining();
    const jobId = draining
      ? await queueReprocessDuringDrain(ctx, args)
      : await requeueRoomMedia(ctx, args);
    if (draining) return null;
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Media job not found");
    const workflowId = await managedWorkflow.start(
      ctx,
      job.workflowVersion === 2
        ? internal.media.pipeline.mediaPipelineV2
        : internal.media.pipeline.mediaPipeline,
      { jobId },
      {
        onComplete: internal.media.pipeline.onPipelineComplete,
        context: { jobId },
      },
    );
    await attachWorkflowToJob(ctx, jobId, workflowId);
    return null;
  },
});

export const releaseQueuedV2 = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx: MutationCtx) => {
    if ((await workflowVersion(ctx)) !== 2)
      throw new Error("route v2 before releasing queued work");
    const queued = await ctx.db
      .query("mediaJobs")
      .withIndex("by_state", (q) => q.eq("state", "queued"))
      .first();
    if (!queued) return false;
    if (queued.workflowId) throw new Error(`Queued job ${queued._id} already has a workflow`);
    const jobId = queued._id;
    await ctx.db.patch(jobId, { workflowVersion: 2 });
    const workflowId = await managedWorkflow.start(
      ctx,
      internal.media.pipeline.mediaPipelineV2,
      { jobId },
      {
        onComplete: internal.media.pipeline.onPipelineComplete,
        context: { jobId },
      },
    );
    await attachWorkflowToJob(ctx, jobId, workflowId);
    return true;
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

async function requireRun(ctx: { db: QueryCtx["db"] }, jobId: Id<"mediaJobs">, workflowId: string) {
  const job = await ctx.db.get(jobId);
  if (!job || job.workflowId !== workflowId || job.state !== "processing")
    throw new Error("Media run is no longer current");
  return job;
}

export const claimAsset = internalMutation({
  args: {
    jobId: v.id("mediaJobs"),
    workflowId: vWorkflowId,
    extractor: v.string(),
    sourceId: v.string(),
    title: v.optional(v.string()),
    duration: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRun(ctx, args.jobId, args.workflowId);
    return await claimAssetForJob(ctx, args);
  },
});

export const recordStageResult = internalMutation({
  args: { jobId: v.id("mediaJobs"), workflowId: vWorkflowId, result: stageResult },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRun(ctx, args.jobId, args.workflowId);
    await recordStageResultForJob(ctx, args);
    return null;
  },
});

export const recordLrclib = internalMutation({
  args: { jobId: v.id("mediaJobs"), workflowId: vWorkflowId, result: lrclibResult },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await requireRun(ctx, args.jobId, args.workflowId);
    if (!job.asset) throw new Error("Run has no claimed asset");
    const asset = await ctx.db.get(job.asset);
    if (asset?.activeJob !== job._id) throw new Error("Run does not own asset");
    const existing = await getLyricTrack(ctx, asset._id, "lrclib");
    if (existing && existing.state !== "processing") return null;
    const value = {
      asset: asset._id,
      source: "lrclib",
      label: "LRCLIB",
      timing: "line" as const,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      ...args.result,
    };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert("mediaLyricTracks", value);
    return null;
  },
});

type RoomMediaNotification =
  | { kind: "ready"; assetId: Id<"mediaAssets"> }
  | { kind: "failed"; jobId: Id<"mediaJobs">; message: string };
type RoomMediaNotificationBatch = {
  sourceJobId: Id<"mediaJobs"> | null;
  sourceAssetId: Id<"mediaAssets"> | null;
  readyAssetId: Id<"mediaAssets"> | null;
  kind: "ready" | "failed";
  message: string | null;
  cursor: string | null;
};

const ROOM_MEDIA_NOTIFICATION_BATCH_SIZE = 100;

async function scheduleRoomMediaNotifications(
  ctx: MutationCtx,
  associations: Array<Doc<"roomMedia">>,
  notification: RoomMediaNotification,
) {
  await Promise.all(
    associations.map((association) =>
      notification.kind === "ready"
        ? ctx.scheduler.runAfter(0, internal.playback.onRoomMediaReady, {
            roomMediaId: association._id,
            jobId: association.job,
            assetId: notification.assetId,
          })
        : ctx.scheduler.runAfter(0, internal.playback.onRoomMediaFailed, {
            roomMediaId: association._id,
            jobId: notification.jobId,
            message: notification.message,
          }),
    ),
  );
}

async function dispatchRoomMediaNotificationBatch(
  ctx: MutationCtx,
  args: RoomMediaNotificationBatch,
) {
  if ((args.sourceJobId === null) === (args.sourceAssetId === null))
    throw new Error("Exactly one room media notification source is required");

  const page =
    args.sourceJobId !== null
      ? await ctx.db
          .query("roomMedia")
          .withIndex("by_job", (q) => q.eq("job", args.sourceJobId!))
          .paginate({ cursor: args.cursor, numItems: ROOM_MEDIA_NOTIFICATION_BATCH_SIZE })
      : await ctx.db
          .query("roomMedia")
          .withIndex("by_asset", (q) => q.eq("asset", args.sourceAssetId!))
          .paginate({ cursor: args.cursor, numItems: ROOM_MEDIA_NOTIFICATION_BATCH_SIZE });

  if (args.kind === "ready") {
    if (args.readyAssetId === null) throw new Error("Ready notification asset is required");
    await scheduleRoomMediaNotifications(ctx, page.page, {
      kind: "ready",
      assetId: args.readyAssetId,
    });
  } else {
    if (args.sourceJobId === null || args.message === null)
      throw new Error("Failed notification job and message are required");
    await scheduleRoomMediaNotifications(ctx, page.page, {
      kind: "failed",
      jobId: args.sourceJobId,
      message: args.message,
    });
  }

  if (!page.isDone)
    await ctx.scheduler.runAfter(0, internal.media.jobs.continueRoomMediaNotifications, {
      ...args,
      cursor: page.continueCursor,
    });
}

export const continueRoomMediaNotifications = internalMutation({
  args: {
    sourceJobId: v.union(v.id("mediaJobs"), v.null()),
    sourceAssetId: v.union(v.id("mediaAssets"), v.null()),
    readyAssetId: v.union(v.id("mediaAssets"), v.null()),
    kind: v.union(v.literal("ready"), v.literal("failed")),
    message: v.union(v.string(), v.null()),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await dispatchRoomMediaNotificationBatch(ctx, args);
    return null;
  },
});

export const completeFromAsset = internalMutation({
  args: { jobId: v.id("mediaJobs"), workflowId: vWorkflowId, assetId: v.id("mediaAssets") },
  returns: v.null(),
  handler: async (ctx, { jobId, assetId, workflowId }) => {
    await requireRun(ctx, jobId, workflowId);
    await completeJobFromAsset(ctx, jobId, assetId);
    await dispatchRoomMediaNotificationBatch(ctx, {
      sourceJobId: jobId,
      sourceAssetId: null,
      readyAssetId: assetId,
      kind: "ready",
      message: null,
      cursor: null,
    });
    return null;
  },
});

export const finalizeAsset = internalMutation({
  args: { jobId: v.id("mediaJobs"), workflowId: vWorkflowId },
  returns: v.id("mediaAssets"),
  handler: async (ctx, { jobId, workflowId }) => {
    await requireRun(ctx, jobId, workflowId);
    const assetId = await finalizeAssetForJob(ctx, jobId);
    await dispatchRoomMediaNotificationBatch(ctx, {
      sourceJobId: null,
      sourceAssetId: assetId,
      readyAssetId: assetId,
      kind: "ready",
      message: null,
      cursor: null,
    });
    return assetId;
  },
});

export const failJob = internalMutation({
  args: {
    jobId: v.id("mediaJobs"),
    workflowId: vWorkflowId,
    errorCode: v.string(),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.workflowId !== args.workflowId || job.state !== "processing") return null;
    await failMediaJob(ctx, args);
    await dispatchRoomMediaNotificationBatch(ctx, {
      sourceJobId: args.jobId,
      sourceAssetId: null,
      readyAssetId: null,
      kind: "failed",
      message: args.errorMessage,
      cursor: null,
    });
    return null;
  },
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
    const assetId = association.asset ?? job.asset;
    const asset = assetId ? await ctx.db.get("mediaAssets", assetId) : null;
    const enrichment = asset ? await getMediaEnrichment(ctx, asset._id) : null;
    const managedSteps = await workflowProgressSteps(ctx, [job.workflowId, enrichment?.workflowId]);
    return {
      _id: job._id,
      state: job.state,
      steps: managedSteps,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      asset: asset
        ? {
            _id: asset._id,
            title: asset.title,
            duration: asset.duration,
            finalArtifactId: asset.finalArtifactId,
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
  args: {
    roomId: v.id("rooms"),
    queuedOnly: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, { roomId, queuedOnly }) => {
    await requireRoomAccess(ctx, roomId);
    const associations = queuedOnly
      ? (
          await Promise.all(
            [
              ...new Set(
                await (async () => {
                  const playback = await ctx.db
                    .query("roomPlayback")
                    .withIndex("by_room", (q) => q.eq("room", roomId))
                    .unique();
                  if (!playback) return [] as Id<"roomMedia">[];
                  const current =
                    playback.state.kind === "occupiedPlaying" ||
                    playback.state.kind === "occupiedPaused"
                      ? playback.state.current
                      : playback.state.kind === "empty" && playback.state.transport.kind !== "idle"
                        ? playback.state.transport.current
                        : null;
                  return [
                    ...(current ? [current.roomMedia] : []),
                    ...playback.state.queue.map((item) => item.roomMedia),
                  ];
                })(),
              ),
            ].map(async (roomMediaId) => await ctx.db.get(roomMediaId)),
          )
        ).filter((association): association is Doc<"roomMedia"> => association?.room === roomId)
      : await ctx.db
          .query("roomMedia")
          .withIndex("by_room", (q) => q.eq("room", roomId))
          .order("desc")
          .take(50);

    return await Promise.all(
      associations.map(async (association) => {
        const job = await ctx.db.get("mediaJobs", association.job);
        const assetId = association.asset ?? job?.asset;
        const asset = assetId ? await ctx.db.get("mediaAssets", assetId) : null;
        const lyricTracks = asset
          ? await ctx.db
              .query("mediaLyricTracks")
              .withIndex("by_asset", (q) => q.eq("asset", asset._id))
              .take(20)
          : [];
        const enrichment = asset ? await getMediaEnrichment(ctx, asset._id) : null;
        const managedSteps = await workflowProgressSteps(ctx, [
          job?.workflowId,
          enrichment?.workflowId,
        ]);
        const annotationsUrl = asset
          ? await mediaArtifactUrl(ctx, asset.annotationsArtifactId)
          : null;
        const lyrics = (
          await Promise.all(
            lyricTracks.map(async (track) => {
              if (track.state !== "ready") return null;
              const timedUrl = track.observations?.length
                ? null
                : await mediaArtifactUrl(ctx, track.timedArtifactId);
              if (!track.observations?.length && !timedUrl) return null;
              return {
                id: track.source,
                label: track.label,
                timing: track.timing,
                suggestedOffsetMs: track.suggestedOffsetMs,
                content: track.observations?.length
                  ? { kind: "inline" as const, observations: track.observations }
                  : { kind: "url" as const, url: timedUrl! },
                captionsUrl: await mediaArtifactUrl(ctx, track.textArtifactId),
                title:
                  [track.metadata?.trackName, track.metadata?.artistName]
                    .filter(Boolean)
                    .join(" — ") ||
                  (track.source === "generated" ? "Automatically generated lyrics" : track.label),
              };
            }),
          )
        ).filter((track) => track !== null);
        return {
          _id: association._id,
          selectedLyricsId: association.selectedLyricsId,
          lyricsOffsetMs: association.lyricsOffsetMs ?? 0,
          jobId: association.job,
          state: job?.state ?? "failed",
          steps: managedSteps,
          title: asset?.title,
          duration: asset?.duration,
          errorMessage: job?.errorMessage,
          sourceUrl: asset ? await mediaArtifactUrl(ctx, asset.sourceArtifactId) : null,
          instrumentalUrl: asset ? await mediaArtifactUrl(ctx, asset.instrumentalArtifactId) : null,
          finalUrl: asset ? await mediaArtifactUrl(ctx, asset.finalArtifactId) : null,
          lyrics,
          annotationsUrl,
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
