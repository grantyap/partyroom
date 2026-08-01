import { v } from "convex/values";
import { vWorkflowId } from "@convex-dev/workflow";
import { type ArtifactId } from "@partyroom/activities";
import type { Id } from "../_generated/dataModel";
import { components, internal } from "../_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "../_generated/server";
import { activities, managedWorkflow } from "../activities/workflowManager";
import { getCurrentUserImpl } from "../auth";
import { userHasRoomPermission } from "../rooms";
import { mediaPipelineStepStatuses } from "./progress";
import {
  attachWorkflowToJob,
  claimAssetForJob,
  completeJobFromAsset,
  createOrJoinMedia,
  deleteCompletedMediaAsset,
  failMediaJob,
  finalizeAssetForJob,
  getLyricTrack,
  markJobAnnotationsFailed,
  recordStageResultForJob,
  requeueRoomMedia,
  removeRoomMedia,
} from "./service";
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
        startedAt: status?.startedAt,
        completedAt: status?.completedAt,
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

export const markAnnotationsFailed = internalMutation({
  args: { jobId: v.id("mediaJobs"), errorMessage: v.string() },
  handler: async (ctx, { jobId, errorMessage }) =>
    await markJobAnnotationsFailed(ctx, jobId, errorMessage),
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

export const getLyricOffsetSuggestionInputs = internalQuery({
  args: { jobId: v.id("mediaJobs") },
  returns: v.union(
    v.null(),
    v.object({
      generatedLyricsUrl: v.string(),
      referenceObservations: v.array(lyricObservation),
      referenceTiming: v.union(v.literal("word"), v.literal("line")),
    }),
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("mediaJobs", jobId);
    if (!job?.asset) return null;
    const asset = await ctx.db.get("mediaAssets", job.asset);
    if (!asset || asset.activeJob !== job._id) return null;
    const [generated, lrclib] = await Promise.all([
      getLyricTrack(ctx, asset._id, "generated"),
      getLyricTrack(ctx, asset._id, "lrclib"),
    ]);
    if (
      generated?.state !== "ready" ||
      !generated.timedArtifactId ||
      lrclib?.state !== "ready" ||
      !lrclib.observations?.length
    ) {
      return null;
    }
    const generatedLyricsUrl = await mediaArtifactUrl(ctx, generated.timedArtifactId);
    return generatedLyricsUrl
      ? {
          generatedLyricsUrl,
          referenceObservations: lrclib.observations,
          referenceTiming: lrclib.timing,
        }
      : null;
  },
});

export const recordSuggestedLyricOffset = internalMutation({
  args: {
    jobId: v.id("mediaJobs"),
    source: v.string(),
    suggestedOffsetMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, source, suggestedOffsetMs }) => {
    const job = await ctx.db.get("mediaJobs", jobId);
    if (!job?.asset) return null;
    const asset = await ctx.db.get("mediaAssets", job.asset);
    if (!asset || asset.activeJob !== job._id) return null;
    const track = await getLyricTrack(ctx, asset._id, source);
    if (track) {
      await ctx.db.patch("mediaLyricTracks", track._id, {
        suggestedOffsetMs,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
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
    const lyricTracks = asset
      ? await ctx.db
          .query("mediaLyricTracks")
          .withIndex("by_asset", (q) => q.eq("asset", asset._id))
          .take(20)
      : [];
    const generatedLyrics = lyricTracks.find(({ source }) => source === "generated");
    const lrclibLyrics = lyricTracks.find(({ source }) => source === "lrclib");
    const activities = await activityStatuses(ctx, job.activeActivities);
    return {
      _id: job._id,
      state: job.state,
      steps: mediaPipelineStepStatuses({
        hasAsset: !!job.asset,
        hasGeneratedLyrics: !!generatedLyrics?.timedArtifactId,
        lrclibLyricsState: lrclibLyrics?.state,
        lrclibLyricsTiming: lrclibLyrics
          ? {
              startedAt: lrclibLyrics.createdAt,
              ...(lrclibLyrics.state === "processing"
                ? {}
                : { completedAt: lrclibLyrics.updatedAt }),
            }
          : undefined,
        asset,
        activities,
        timings: job.stepTimings ?? [],
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
        const lyricTracks = asset
          ? await ctx.db
              .query("mediaLyricTracks")
              .withIndex("by_asset", (q) => q.eq("asset", asset._id))
              .take(20)
          : [];
        const activities = await activityStatuses(ctx, job?.activeActivities);
        const generatedLyrics = lyricTracks.find(({ source }) => source === "generated");
        const lrclibLyrics = lyricTracks.find(({ source }) => source === "lrclib");
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
          jobId: association.job,
          state: job?.state ?? "failed",
          steps: mediaPipelineStepStatuses({
            hasAsset: !!job?.asset,
            hasGeneratedLyrics: !!generatedLyrics?.timedArtifactId,
            lrclibLyricsState: lrclibLyrics?.state,
            lrclibLyricsTiming: lrclibLyrics
              ? {
                  startedAt: lrclibLyrics.createdAt,
                  ...(lrclibLyrics.state === "processing"
                    ? {}
                    : { completedAt: lrclibLyrics.updatedAt }),
                }
              : undefined,
            asset,
            activities,
            timings: job?.stepTimings ?? [],
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
