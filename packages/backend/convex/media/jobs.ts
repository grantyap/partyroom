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
  type QueryCtx,
} from "../_generated/server";
import { activities, managedWorkflow } from "../activities/workflowManager";
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
  requeueRoomMedia,
  removeRoomMedia,
} from "./domain/jobs";
import { getLyricTrack } from "./domain/lyrics";
import { mediaPipelineStepStatuses, workflowPipelineStepStatuses } from "./progress/model";
import {
  lyricTrackMetadata,
  lyricTrackState,
  lyricObservation,
  mediaOperationKind,
  type OperationKind,
} from "./validators";

async function mediaArtifactUrl(ctx: QueryCtx, artifactId: string | undefined) {
  return artifactId ? await activities.getArtifactUrl(ctx, artifactId as ArtifactId) : null;
}

export { removeRoomMedia as removeFromRoomImpl } from "./domain/jobs";

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
        startedAt: status?.startedAt,
        completedAt: status?.completedAt,
      };
    }),
  );
}

async function workflowProgressSteps(
  ctx: Pick<QueryCtx, "runQuery">,
  workflowIds: Array<string | undefined>,
) {
  const workflows = await Promise.all(
    workflowIds
      .filter((workflowId): workflowId is string => workflowId !== undefined)
      .map(async (workflowId) => await managedWorkflow.getProgress(ctx, workflowId as WorkflowId)),
  );
  return workflowPipelineStepStatuses(...workflows);
}

async function requireRoomAccess(ctx: QueryCtx, roomId: Id<"rooms">) {
  const { user } = await requireRoomAction(ctx, roomId, "rooms:read");
  return user._id;
}

export const authorizeRequest = internalQuery({
  args: { roomId: v.id("rooms") },
  returns: v.string(),
  handler: async (ctx, { roomId }) => {
    const { user } = await requireRoomAction(ctx, roomId, "rooms:addToQueue");
    return user._id;
  },
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
  returns: v.object({
    jobId: v.id("mediaJobs"),
    roomMediaId: v.id("roomMedia"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await createOrJoinMedia(ctx, args);
    if (result.created) {
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
    const queued = await ctx.db
      .query("roomQueueItems")
      .withIndex("by_room_media", (q) =>
        q.eq("room", args.roomId).eq("roomMedia", args.roomMediaId),
      )
      .first();
    if (queued) throw new Error("Remove this media from the queue first");
    await removeRoomMedia(ctx, args);
    return null;
  },
});

export const reprocess = mutation({
  args: { roomId: v.id("rooms"), roomMediaId: v.id("roomMedia") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRoomAccess(ctx, args.roomId);
    const jobId = await requeueRoomMedia(ctx, args);
    const workflowId = await managedWorkflow.start(
      ctx,
      internal.media.pipeline.mediaPipeline,
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

export const recordLyricTrack = internalMutation({
  args: {
    jobId: v.id("mediaJobs"),
    source: v.string(),
    label: v.string(),
    timing: v.union(v.literal("word"), v.literal("line")),
    state: lyricTrackState,
    textArtifactId: v.optional(v.string()),
    timedArtifactId: v.optional(v.string()),
    observations: v.optional(v.array(lyricObservation)),
    metadata: v.optional(lyricTrackMetadata),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("mediaJobs", args.jobId);
    if (!job?.asset) throw new Error("Media job has no claimed asset");
    const asset = await ctx.db.get("mediaAssets", job.asset);
    if (!asset || asset.activeJob !== job._id) {
      throw new Error("Media job no longer owns its claimed asset");
    }
    const existing = await getLyricTrack(ctx, asset._id, args.source);
    const now = Date.now();
    const value = {
      asset: asset._id,
      source: args.source,
      label: args.label,
      timing: args.timing,
      state: args.state,
      textArtifactId: args.textArtifactId,
      timedArtifactId: args.timedArtifactId,
      observations: args.observations,
      metadata: args.metadata,
      error: args.errorMessage?.slice(0, 2_000),
      updatedAt: now,
    };
    if (existing) await ctx.db.patch("mediaLyricTracks", existing._id, value);
    else await ctx.db.insert("mediaLyricTracks", { ...value, createdAt: now });
    return null;
  },
});

export const completeFromAsset = internalMutation({
  args: { jobId: v.id("mediaJobs"), assetId: v.id("mediaAssets") },
  returns: v.null(),
  handler: async (ctx, { jobId, assetId }) => {
    await completeJobFromAsset(ctx, jobId, assetId);
    const associations = await ctx.db
      .query("roomMedia")
      .withIndex("by_job", (q) => q.eq("job", jobId))
      .take(100);
    await Promise.all(
      associations.map((association) =>
        ctx.scheduler.runAfter(0, internal.playback.onRoomMediaReady, {
          roomMediaId: association._id,
        }),
      ),
    );
    return null;
  },
});

export const finalizeAsset = internalMutation({
  args: { jobId: v.id("mediaJobs") },
  returns: v.id("mediaAssets"),
  handler: async (ctx, { jobId }) => {
    const assetId = await finalizeAssetForJob(ctx, jobId);
    const associations = await ctx.db
      .query("roomMedia")
      .withIndex("by_asset", (q) => q.eq("asset", assetId))
      .take(100);
    await Promise.all(
      associations.map((association) =>
        ctx.scheduler.runAfter(0, internal.playback.onRoomMediaReady, {
          roomMediaId: association._id,
        }),
      ),
    );
    return assetId;
  },
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
    const lyricTracks = asset
      ? await ctx.db
          .query("mediaLyricTracks")
          .withIndex("by_asset", (q) => q.eq("asset", asset._id))
          .take(20)
      : [];
    const generatedLyrics = lyricTracks.find(({ source }) => source === "generated");
    const lrclibLyrics = lyricTracks.find(({ source }) => source === "lrclib");
    const enrichment = asset ? await getMediaEnrichment(ctx, asset._id) : null;
    const managedSteps = await workflowProgressSteps(ctx, [job.workflowId, enrichment?.workflowId]);
    const activityRows = await activityStatuses(ctx, [
      ...(job.activeActivities ?? []),
      ...(enrichment?.activeActivities ?? []),
    ]);
    return {
      _id: job._id,
      state: job.state,
      steps:
        managedSteps.length > 0
          ? managedSteps
          : mediaPipelineStepStatuses({
              hasAsset: !!job.asset,
              hasGeneratedLyrics: !!generatedLyrics?.timedArtifactId,
              generatedLyricsState: generatedLyrics?.state,
              generatedLyricsTiming: generatedLyrics
                ? {
                    startedAt: generatedLyrics.createdAt,
                    ...(generatedLyrics.state === "processing"
                      ? {}
                      : { completedAt: generatedLyrics.updatedAt }),
                  }
                : undefined,
              lrclibLyricsState: lrclibLyrics?.state,
              lrclibLyricsTimingKind: lrclibLyrics?.timing,
              lrclibLyricsTiming: lrclibLyrics
                ? {
                    startedAt: lrclibLyrics.createdAt,
                    ...(lrclibLyrics.state === "processing"
                      ? {}
                      : { completedAt: lrclibLyrics.updatedAt }),
                  }
                : undefined,
              enrichmentState: enrichment?.state,
              asset,
              activities: activityRows,
              timings: [...(job.stepTimings ?? []), ...(enrichment?.stepTimings ?? [])],
            }),
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
                (
                  await ctx.db
                    .query("roomQueueItems")
                    .withIndex("by_room_and_rank", (q) => q.eq("room", roomId))
                    .take(200)
                ).map(({ roomMedia }) => roomMedia),
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
        const generatedLyrics = lyricTracks.find(({ source }) => source === "generated");
        const lrclibLyrics = lyricTracks.find(({ source }) => source === "lrclib");
        const enrichment = asset ? await getMediaEnrichment(ctx, asset._id) : null;
        const managedSteps = await workflowProgressSteps(ctx, [
          job?.workflowId,
          enrichment?.workflowId,
        ]);
        const activityRows = await activityStatuses(ctx, [
          ...(job?.activeActivities ?? []),
          ...(enrichment?.activeActivities ?? []),
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
          steps:
            managedSteps.length > 0
              ? managedSteps
              : mediaPipelineStepStatuses({
                  hasAsset: !!job?.asset,
                  hasGeneratedLyrics: !!generatedLyrics?.timedArtifactId,
                  generatedLyricsState: generatedLyrics?.state,
                  generatedLyricsTiming: generatedLyrics
                    ? {
                        startedAt: generatedLyrics.createdAt,
                        ...(generatedLyrics.state === "processing"
                          ? {}
                          : { completedAt: generatedLyrics.updatedAt }),
                      }
                    : undefined,
                  lrclibLyricsState: lrclibLyrics?.state,
                  lrclibLyricsTimingKind: lrclibLyrics?.timing,
                  lrclibLyricsTiming: lrclibLyrics
                    ? {
                        startedAt: lrclibLyrics.createdAt,
                        ...(lrclibLyrics.state === "processing"
                          ? {}
                          : { completedAt: lrclibLyrics.updatedAt }),
                      }
                    : undefined,
                  enrichmentState: enrichment?.state,
                  asset,
                  activities: activityRows,
                  timings: [...(job?.stepTimings ?? []), ...(enrichment?.stepTimings ?? [])],
                }),
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
