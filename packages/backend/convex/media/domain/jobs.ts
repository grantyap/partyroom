import type { WorkflowId } from "@convex-dev/workflow";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  activities,
  cancelWorkflow,
  managedWorkflow,
  sendWorkflowEvent,
} from "../../activities/workflowManager";
import {
  cancelAssetEnrichment,
  deleteAssetArtifacts,
  deleteAssetEnrichment,
  deleteIncompleteAsset,
  deleteLyricTracks,
} from "./assets";
import type { CoreMediaOperationKind } from "../validators";
import type { stageResult } from "../validators";
import type { Infer } from "convex/values";
import { workflowVersion } from "../../migration/workflowRouting";
import { isDraining } from "../../migration/drain";

// v5 emits browser-friendly H.264/AAC MP4s instead of preserving the source
// video codec. Keep prior assets on their original cache version.
const mediaPipelineVersion = 5;

async function requireJob(ctx: Pick<QueryCtx, "db">, jobId: Id<"mediaJobs">) {
  const job = await ctx.db.get("mediaJobs", jobId);
  if (!job) throw new Error("Media job not found");
  return job;
}

async function requireOwnedAsset(ctx: Pick<QueryCtx, "db">, jobId: Id<"mediaJobs">) {
  const job = await requireJob(ctx, jobId);
  if (job.state !== "processing") throw new Error("Run is not processing");
  if (!job.asset) throw new Error("Media job has no claimed asset");
  const asset = await ctx.db.get("mediaAssets", job.asset);
  if (!asset) throw new Error("Media job references a missing asset");
  if (asset.activeJob !== jobId) {
    throw new Error("Media job no longer owns its claimed asset");
  }
  return { job, asset };
}

export async function getActivityJobState(
  ctx: Pick<QueryCtx, "db">,
  jobId: Id<"mediaJobs">,
  kind: CoreMediaOperationKind,
) {
  if (kind === "resolve") {
    return { job: await requireJob(ctx, jobId), asset: null };
  }
  return await requireOwnedAsset(ctx, jobId);
}

export async function createOrJoinMedia(
  ctx: MutationCtx,
  args: {
    roomId: Id<"rooms">;
    requestedBy: string;
    requestKey: string;
    encryptedSource: string;
    sourceIv: string;
  },
) {
  const candidates = (
    await Promise.all(
      (["queued", "processing", "ready"] as const).map(
        async (state) =>
          await ctx.db
            .query("mediaJobs")
            .withIndex("by_request_key_and_state", (q) =>
              q.eq("requestKey", args.requestKey).eq("state", state),
            )
            .order("desc")
            .first(),
      ),
    )
  )
    .filter((candidate): candidate is Doc<"mediaJobs"> => candidate !== null)
    .sort((left, right) => right._creationTime - left._creationTime);

  let existing: Doc<"mediaJobs"> | null = null;
  let existingAsset: Doc<"mediaAssets"> | null = null;
  for (const candidate of candidates) {
    if (
      candidate.state !== "queued" &&
      candidate.state !== "processing" &&
      candidate.state !== "ready"
    )
      continue;
    const asset = candidate.asset ? await ctx.db.get("mediaAssets", candidate.asset) : null;
    if (
      candidate.state === "ready" &&
      (!asset || asset.state !== "ready" || !asset.finalArtifactId)
    )
      continue;
    existing = candidate;
    existingAsset = asset;
    break;
  }

  if (existing) {
    const roomMedia = await ctx.db
      .query("roomMedia")
      .withIndex("by_room_job", (q) => q.eq("room", args.roomId).eq("job", existing!._id))
      .first();
    if (roomMedia && existingAsset?.state === "ready" && roomMedia.asset !== existingAsset._id) {
      await ctx.db.patch("roomMedia", roomMedia._id, {
        asset: existingAsset._id,
      });
    }
    const roomMediaId =
      roomMedia?._id ??
      (await ctx.db.insert("roomMedia", {
        room: args.roomId,
        job: existing._id,
        ...(existingAsset?.state === "ready" ? { asset: existingAsset._id } : {}),
        requestedBy: args.requestedBy,
        createdAt: Date.now(),
      }));
    return {
      jobId: existing._id,
      roomMediaId,
      created: false,
      workflowVersion: existing.workflowVersion ?? 1,
    };
  }

  const now = Date.now();
  const version = await workflowVersion(ctx);
  const jobId = await ctx.db.insert("mediaJobs", {
    workflowVersion: version,
    requestKey: args.requestKey,
    encryptedSource: args.encryptedSource,
    sourceIv: args.sourceIv,
    requestedBy: args.requestedBy,
    state: "queued",
    ...(isDraining() ? { stage: "queued", progress: 0 } : {}),
    createdAt: now,
    updatedAt: now,
  });
  const roomMediaId = await ctx.db.insert("roomMedia", {
    room: args.roomId,
    job: jobId,
    requestedBy: args.requestedBy,
    createdAt: now,
  });
  return { jobId, roomMediaId, created: true, workflowVersion: version };
}

export async function attachWorkflowToJob(
  ctx: MutationCtx,
  jobId: Id<"mediaJobs">,
  workflowId: string,
) {
  const job = await requireJob(ctx, jobId);
  if (job.state !== "queued" || job.workflowId) throw new Error("Run already started");
  await ctx.db.patch("mediaJobs", jobId, {
    workflowId,
    state: "processing",
    updatedAt: Date.now(),
  });
}

export async function requeueRoomMedia(
  ctx: MutationCtx,
  {
    roomId,
    roomMediaId,
  }: {
    roomId: Id<"rooms">;
    roomMediaId: Id<"roomMedia">;
  },
) {
  const association = await ctx.db.get("roomMedia", roomMediaId);
  if (!association || association.room !== roomId) throw new Error("Room media item not found");

  const job = await ctx.db.get("mediaJobs", association.job);
  if (!job) throw new Error("Media job not found");
  if (job.state === "queued" || job.state === "processing") {
    throw new Error("Media is already being processed");
  }

  // A room selects a new run. Other rooms and published revisions are untouched.
  const now = Date.now();
  const version = await workflowVersion(ctx);
  const jobId = await ctx.db.insert("mediaJobs", {
    workflowVersion: version,
    requestKey: job.requestKey,
    encryptedSource: job.encryptedSource,
    sourceIv: job.sourceIv,
    requestedBy: job.requestedBy,
    rebuild: true,
    ...(isDraining() ? { rebuildOf: job._id, stage: "queued", progress: 0 } : {}),
    state: "queued",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch("roomMedia", association._id, { job: jobId });
  await deleteUnreferencedFailedRevision(ctx, job);
  return jobId;
}

async function deleteUnreferencedFailedRevision(ctx: MutationCtx, job: Doc<"mediaJobs">) {
  if (job.state !== "failed" && job.state !== "canceled") return;
  if (
    await ctx.db
      .query("roomMedia")
      .withIndex("by_job", (q) => q.eq("job", job._id))
      .first()
  )
    return;
  if (!job.asset) {
    await ctx.db.delete("mediaJobs", job._id);
    return;
  }
  const asset = await ctx.db.get("mediaAssets", job.asset);
  if (!asset || asset.state !== "failed") return;
  const assetJobs = await ctx.db
    .query("mediaJobs")
    .withIndex("by_asset", (q) => q.eq("asset", asset._id))
    .collect();
  if (assetJobs.some((related) => related.state !== "failed" && related.state !== "canceled"))
    return;
  for (const related of assetJobs) {
    if (
      await ctx.db
        .query("roomMedia")
        .withIndex("by_job", (q) => q.eq("job", related._id))
        .first()
    )
      return;
  }
  await deleteIncompleteAsset(ctx, asset);
  for (const related of assetJobs) await ctx.db.delete("mediaJobs", related._id);
}

export async function queueReprocessDuringDrain(
  ctx: MutationCtx,
  { roomId, roomMediaId }: { roomId: Id<"rooms">; roomMediaId: Id<"roomMedia"> },
) {
  return await requeueRoomMedia(ctx, { roomId, roomMediaId });
}

export async function removeRoomMedia(
  ctx: MutationCtx,
  {
    roomId,
    roomMediaId,
  }: {
    roomId: Id<"rooms">;
    roomMediaId: Id<"roomMedia">;
  },
) {
  const association = await ctx.db.get("roomMedia", roomMediaId);
  if (!association || association.room !== roomId) throw new Error("Room media item not found");

  const job = await ctx.db.get("mediaJobs", association.job);
  await ctx.db.delete("roomMedia", association._id);
  if (!job) return;

  const remainingAssociation = await ctx.db
    .query("roomMedia")
    .withIndex("by_job", (q) => q.eq("job", job._id))
    .first();
  if (remainingAssociation) return;

  if (job.state === "ready") {
    await ctx.db.delete("mediaJobs", job._id);
    return;
  }

  const asset = job.asset ? await ctx.db.get("mediaAssets", job.asset) : null;
  const relatedJobs = job.asset
    ? (
        await ctx.db
          .query("mediaJobs")
          .withIndex("by_asset", (q) => q.eq("asset", job.asset))
          .collect()
      ).filter((related) => related._id !== job._id)
    : [];
  const hasActiveDependent = relatedJobs.some(
    (related) => related.state === "queued" || related.state === "processing",
  );

  if (asset?.activeJob === job._id && hasActiveDependent) return;

  if (job.workflowId) {
    try {
      await managedWorkflow.cancelActivities(ctx, job.workflowId as WorkflowId);
      await cancelWorkflow(ctx, job.workflowId as WorkflowId);
    } catch (error) {
      console.warn(`Unable to cancel media workflow ${job.workflowId}`, error);
    }
  }

  if (asset?.activeJob === job._id && relatedJobs.length > 0) {
    await failMediaJob(ctx, {
      jobId: job._id,
      errorCode: "CANCELED",
      errorMessage: "Media was removed",
    });
  }
  if (asset && asset.state !== "ready" && relatedJobs.length === 0) {
    await deleteIncompleteAsset(ctx, asset);
  }
  await ctx.db.delete("mediaJobs", job._id);
}

export async function deleteCompletedMediaAsset(ctx: MutationCtx, assetId: Id<"mediaAssets">) {
  const asset = await ctx.db.get("mediaAssets", assetId);
  if (!asset) throw new Error("Media asset not found");
  if (asset.state !== "ready") {
    throw new Error("Only successfully completed media assets can be deleted");
  }

  const jobs = await ctx.db
    .query("mediaJobs")
    .withIndex("by_asset", (q) => q.eq("asset", assetId))
    .collect();
  if (jobs.some((job) => job.state === "queued" || job.state === "processing")) {
    throw new Error("Media asset is still referenced by an unfinished job");
  }

  const deletedJobs = jobs.filter((job) => job.state === "ready");
  const deletedJobIds = new Set(deletedJobs.map((job) => job._id));
  const associations = new Map<string, Id<"roomMedia">>();
  for (const association of await ctx.db
    .query("roomMedia")
    .withIndex("by_asset", (q) => q.eq("asset", assetId))
    .collect()) {
    if (deletedJobIds.has(association.job)) {
      associations.set(association._id, association._id);
    } else {
      await ctx.db.patch("roomMedia", association._id, { asset: undefined });
    }
  }
  for (const job of deletedJobs) {
    for (const association of await ctx.db
      .query("roomMedia")
      .withIndex("by_job", (q) => q.eq("job", job._id))
      .collect()) {
      associations.set(association._id, association._id);
    }
  }

  for (const associationId of associations.values()) {
    await ctx.db.delete("roomMedia", associationId);
  }
  for (const job of deletedJobs) await ctx.db.delete("mediaJobs", job._id);
  for (const job of jobs) {
    if (job.state === "failed" || job.state === "canceled") {
      await ctx.db.patch("mediaJobs", job._id, { asset: undefined });
    }
  }
  await deleteAssetEnrichment(ctx, assetId);
  const deletedStorageObjects =
    (await deleteAssetArtifacts(ctx, asset)) + (await deleteLyricTracks(ctx, assetId));
  await ctx.db.delete("mediaAssets", assetId);

  return {
    deletedJobs: deletedJobs.length,
    deletedRoomMedia: associations.size,
    deletedStorageObjects,
  };
}

export async function claimAssetForJob(
  ctx: MutationCtx,
  args: {
    jobId: Id<"mediaJobs">;
    extractor: string;
    sourceId: string;
    title?: string;
    duration?: number;
  },
) {
  const job = await requireJob(ctx, args.jobId);
  if (job.state !== "processing") throw new Error("Run is not processing");
  if (job.asset) {
    const asset = await ctx.db.get(job.asset);
    if (asset?.activeJob === job._id) return { mode: "owner" as const, assetId: asset._id };
    throw new Error("Run already claimed an asset");
  }
  const cacheKey = `v${mediaPipelineVersion}:${args.extractor.toLowerCase()}:${args.sourceId}`;
  let existing: Doc<"mediaAssets"> | null = null;
  if (!job.rebuild) {
    existing = await ctx.db
      .query("mediaAssets")
      .withIndex("by_cache_key_and_state", (q) => q.eq("cacheKey", cacheKey).eq("state", "ready"))
      .order("desc")
      .first();
    if (!existing) {
      existing = await ctx.db
        .query("mediaAssets")
        .withIndex("by_cache_key_and_state", (q) =>
          q.eq("cacheKey", cacheKey).eq("state", "processing"),
        )
        .order("desc")
        .first();
    }
  }
  const now = Date.now();
  if (existing) {
    await ctx.db.patch("mediaJobs", args.jobId, {
      asset: existing._id,
      updatedAt: now,
    });
    if (existing.state === "ready" && existing.finalArtifactId)
      return { mode: "cached" as const, assetId: existing._id };
    if (existing.activeJob && existing.activeJob !== args.jobId)
      return { mode: "waiting" as const, assetId: existing._id };
    if (existing.activeJob === args.jobId && existing.state === "processing")
      return { mode: "owner" as const, assetId: existing._id };
  }

  const assetId = await ctx.db.insert("mediaAssets", {
    cacheKey,
    extractor: args.extractor,
    sourceId: args.sourceId,
    state: "processing",
    annotationsState: "processing",
    activeJob: args.jobId,
    title: args.title,
    duration: args.duration,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch("mediaJobs", args.jobId, {
    asset: assetId,
    updatedAt: now,
  });
  return { mode: "owner" as const, assetId };
}

export async function recordStageResultForJob(
  ctx: MutationCtx,
  { jobId, result }: { jobId: Id<"mediaJobs">; result: Infer<typeof stageResult> },
) {
  const { job, asset } = await requireOwnedAsset(ctx, jobId);
  if (result.kind !== "separate")
    await activities.validateProduced(ctx, job.workflowId!, result.artifactId, "artifactId");
  if (result.kind === "separate") {
    await activities.publishArtifacts(ctx, job.workflowId!, asset._id, {
      instrumentalArtifactId: result.instrumentalArtifactId,
      vocalsArtifactId: result.vocalsArtifactId,
    });
  }
  const patch =
    result.kind === "download"
      ? { sourceArtifactId: result.artifactId }
      : result.kind === "extractAudio"
        ? { extractedAudioArtifactId: result.artifactId }
        : result.kind === "separate"
          ? {
              instrumentalArtifactId: result.instrumentalArtifactId,
              vocalsArtifactId: result.vocalsArtifactId,
            }
          : { finalArtifactId: result.artifactId };
  for (const [key, value] of Object.entries(patch)) {
    const previous = asset[key as keyof typeof asset];
    if (previous && previous !== value) throw new Error("Run output is already recorded");
  }
  await ctx.db.patch(asset._id, { ...patch, updatedAt: Date.now() });
}

async function markJobReady(ctx: MutationCtx, jobId: Id<"mediaJobs">, assetId: Id<"mediaAssets">) {
  const job = await requireJob(ctx, jobId);
  if (job.state !== "processing" && job.state !== "ready") throw new Error("Run is not processing");
  if (job.asset && job.asset !== assetId) {
    throw new Error("Media job references a different asset");
  }
  await ctx.db.patch("mediaJobs", jobId, {
    state: "ready",
    asset: assetId,
    updatedAt: Date.now(),
  });
  const roomRows = await ctx.db
    .query("roomMedia")
    .withIndex("by_job", (q) => q.eq("job", jobId))
    .collect();
  await Promise.all(roomRows.map((row) => ctx.db.patch("roomMedia", row._id, { asset: assetId })));
}

export async function completeJobFromAsset(
  ctx: MutationCtx,
  jobId: Id<"mediaJobs">,
  assetId: Id<"mediaAssets">,
) {
  const asset = await ctx.db.get("mediaAssets", assetId);
  if (!asset?.finalArtifactId || asset.state !== "ready")
    throw new Error("Media asset is not ready");
  await markJobReady(ctx, jobId, assetId);
}

export async function finalizeAssetForJob(ctx: MutationCtx, jobId: Id<"mediaJobs">) {
  const { job, asset } = await requireOwnedAsset(ctx, jobId);
  if (!asset.finalArtifactId) throw new Error("Media asset is missing its final video");
  await activities.publishArtifacts(ctx, job.workflowId!, asset._id, {
    artifactId: asset.finalArtifactId,
  });
  await ctx.db.patch("mediaAssets", asset._id, {
    state: "ready",
    sourceArtifactId: undefined,
    extractedAudioArtifactId: undefined,
    activeJob: undefined,
    updatedAt: Date.now(),
  });
  const jobs = await ctx.db
    .query("mediaJobs")
    .withIndex("by_asset", (q) => q.eq("asset", asset._id))
    .collect();
  for (const waitingJob of jobs) {
    if (waitingJob.state !== "queued" && waitingJob.state !== "processing") continue;
    if (waitingJob._id === jobId) await markJobReady(ctx, jobId, asset._id);
    if (waitingJob._id !== jobId && waitingJob.workflowId) {
      await sendWorkflowEvent(ctx, {
        workflowId: waitingJob.workflowId as WorkflowId,
        name: "asset-ready",
        value: asset._id,
      });
    }
  }
  return asset._id;
}

export async function failMediaJob(
  ctx: MutationCtx,
  args: {
    jobId: Id<"mediaJobs">;
    errorCode: string;
    errorMessage: string;
  },
) {
  const job = await ctx.db.get("mediaJobs", args.jobId);
  if (!job || (job.state !== "processing" && job.state !== "queued")) return;
  await ctx.db.patch("mediaJobs", args.jobId, {
    state: "failed",
    errorCode: args.errorCode,
    errorMessage: args.errorMessage,
    updatedAt: Date.now(),
  });
  if (!job.asset) return;
  const asset = await ctx.db.get("mediaAssets", job.asset);
  if (asset?.activeJob !== args.jobId) return;
  await cancelAssetEnrichment(ctx, asset._id);
  await ctx.db.patch("mediaAssets", asset._id, {
    state: "failed",
    sourceArtifactId: undefined,
    extractedAudioArtifactId: undefined,
    finalArtifactId: undefined,
    activeJob: undefined,
    updatedAt: Date.now(),
  });
  const waitingJobs = await ctx.db
    .query("mediaJobs")
    .withIndex("by_asset", (q) => q.eq("asset", asset._id))
    .collect();
  for (const waitingJob of waitingJobs) {
    if (
      waitingJob._id !== args.jobId &&
      waitingJob.workflowId &&
      waitingJob.state === "processing"
    ) {
      await sendWorkflowEvent(ctx, {
        workflowId: waitingJob.workflowId as WorkflowId,
        name: "asset-ready",
        error: args.errorMessage,
      });
    }
  }
}
