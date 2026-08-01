import type { WorkflowId } from "@convex-dev/workflow";
import { type ArtifactId } from "@partyroom/activities";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { activities, cancelWorkflow, sendWorkflowEvent } from "../activities/workflowManager";
import type { CoreMediaOperationKind, OperationKind } from "./validators";

const mediaPipelineVersion = 4;

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

export async function getLyricTrack(
  ctx: Pick<QueryCtx, "db">,
  assetId: Id<"mediaAssets">,
  source: string,
) {
  return await ctx.db
    .query("mediaLyricTracks")
    .withIndex("by_asset_and_source", (q) => q.eq("asset", assetId).eq("source", source))
    .unique();
}

export async function getMediaEnrichment(ctx: Pick<QueryCtx, "db">, assetId: Id<"mediaAssets">) {
  return await ctx.db
    .query("mediaEnrichments")
    .withIndex("by_asset", (q) => q.eq("asset", assetId))
    .unique();
}

async function cancelAssetEnrichment(ctx: MutationCtx, assetId: Id<"mediaAssets">) {
  const enrichment = await getMediaEnrichment(ctx, assetId);
  if (!enrichment || enrichment.state !== "processing") return enrichment;
  if (enrichment.workflowId) {
    try {
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

async function deleteAssetEnrichment(ctx: MutationCtx, assetId: Id<"mediaAssets">) {
  const enrichment = await cancelAssetEnrichment(ctx, assetId);
  if (enrichment) await ctx.db.delete("mediaEnrichments", enrichment._id);
}

async function deleteAssetArtifacts(ctx: MutationCtx, asset: Doc<"mediaAssets">) {
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

async function deleteLyricTracks(ctx: MutationCtx, assetId: Id<"mediaAssets">) {
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

async function deleteIncompleteAsset(ctx: MutationCtx, asset: Doc<"mediaAssets">) {
  await deleteAssetEnrichment(ctx, asset._id);
  await deleteLyricTracks(ctx, asset._id);
  await deleteAssetArtifacts(ctx, asset);
  await ctx.db.delete(asset._id);
}

async function requireJob(ctx: MutationCtx, jobId: Id<"mediaJobs">) {
  const job = await ctx.db.get("mediaJobs", jobId);
  if (!job) throw new Error("Media job not found");
  return job;
}

async function requireOwnedAsset(ctx: MutationCtx, jobId: Id<"mediaJobs">) {
  const job = await requireJob(ctx, jobId);
  if (!job.asset) throw new Error("Media job has no claimed asset");
  const asset = await ctx.db.get("mediaAssets", job.asset);
  if (!asset) throw new Error("Media job references a missing asset");
  if (asset.activeJob !== jobId) {
    throw new Error("Media job no longer owns its claimed asset");
  }
  return { job, asset };
}

export async function getActivityJobState(
  ctx: MutationCtx,
  jobId: Id<"mediaJobs">,
  kind: CoreMediaOperationKind,
) {
  if (kind === "resolve") {
    return { job: await requireJob(ctx, jobId), asset: null };
  }
  return await requireOwnedAsset(ctx, jobId);
}

export async function recordScheduledActivity(
  ctx: MutationCtx,
  {
    jobId,
    activityId,
    kind,
  }: {
    jobId: Id<"mediaJobs">;
    activityId: string;
    kind: CoreMediaOperationKind;
  },
) {
  const { job } = await getActivityJobState(ctx, jobId, kind);
  if (job.activeActivities?.some((activity) => activity.activityId === activityId)) return;
  await ctx.db.patch("mediaJobs", jobId, {
    state: "processing",
    stage:
      kind === "resolve"
        ? "resolving"
        : kind === "download"
          ? "downloading"
          : kind === "extractAudio"
            ? "extracting"
            : kind === "separate"
              ? "separating"
              : "muxing",
    activeActivities: [...(job.activeActivities ?? []), { activityId, kind }],
    updatedAt: Date.now(),
  });
}

export async function recordActivityTerminal(
  ctx: MutationCtx,
  jobId: Id<"mediaJobs">,
  activityId: string,
  timing?: { startedAt: number; completedAt: number },
) {
  const job = await ctx.db.get("mediaJobs", jobId);
  if (!job?.activeActivities) return;
  const terminalActivity = job.activeActivities.find(
    (activity) => activity.activityId === activityId,
  );
  const activeActivities = job.activeActivities.filter(
    (activity) => activity.activityId !== activityId,
  );
  if (activeActivities.length === job.activeActivities.length) return;
  const stepTimings =
    timing && terminalActivity
      ? [
          ...(job.stepTimings ?? []).filter(
            (stepTiming) => stepTiming.kind !== terminalActivity.kind,
          ),
          { kind: terminalActivity.kind, ...timing },
        ]
      : job.stepTimings;
  await ctx.db.patch("mediaJobs", jobId, {
    activeActivities,
    stepTimings,
    updatedAt: Date.now(),
  });
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
  const candidates = await ctx.db
    .query("mediaJobs")
    .withIndex("by_request_key", (q) => q.eq("requestKey", args.requestKey))
    .collect();

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
    return { jobId: existing._id, roomMediaId, created: false };
  }

  const now = Date.now();
  const jobId = await ctx.db.insert("mediaJobs", {
    requestKey: args.requestKey,
    encryptedSource: args.encryptedSource,
    sourceIv: args.sourceIv,
    requestedBy: args.requestedBy,
    state: "queued",
    stage: "queued",
    progress: 0,
    createdAt: now,
    updatedAt: now,
  });
  const roomMediaId = await ctx.db.insert("roomMedia", {
    room: args.roomId,
    job: jobId,
    requestedBy: args.requestedBy,
    createdAt: now,
  });
  return { jobId, roomMediaId, created: true };
}

export async function attachWorkflowToJob(
  ctx: MutationCtx,
  jobId: Id<"mediaJobs">,
  workflowId: string,
) {
  await requireJob(ctx, jobId);
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

  if (job.asset) {
    const asset = await ctx.db.get("mediaAssets", job.asset);
    if (asset?.activeJob && asset.activeJob !== job._id) {
      throw new Error("Media is already being processed");
    }
    if (asset) {
      await cancelAssetEnrichment(ctx, asset._id);
      await ctx.db.patch("mediaAssets", asset._id, {
        state: "failed",
        activeJob: undefined,
        updatedAt: Date.now(),
      });
    }
  }

  const associations = await ctx.db
    .query("roomMedia")
    .withIndex("by_job", (q) => q.eq("job", job._id))
    .collect();
  await Promise.all(
    associations.map((row) => ctx.db.patch("roomMedia", row._id, { asset: undefined })),
  );
  await ctx.db.patch("mediaJobs", job._id, {
    state: "queued",
    stage: "queued",
    progress: 0,
    asset: undefined,
    workflowId: undefined,
    activeActivities: [],
    stepTimings: [],
    errorCode: undefined,
    errorMessage: undefined,
    updatedAt: Date.now(),
  });
  return job._id;
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
      await cancelWorkflow(ctx, job.workflowId as WorkflowId);
    } catch (error) {
      console.warn(`Unable to cancel media workflow ${job.workflowId}`, error);
    }
  }
  for (const activity of job.activeActivities ?? []) {
    await activities.cancel(ctx, activity.activityId as any);
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
    if (job.state === "failed") {
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
  await requireJob(ctx, args.jobId);
  const cacheKey = `v${mediaPipelineVersion}:${args.extractor.toLowerCase()}:${args.sourceId}`;
  const existing = await ctx.db
    .query("mediaAssets")
    .withIndex("by_cache_key", (q) => q.eq("cacheKey", cacheKey))
    .unique();
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

    const staleJobs = await ctx.db
      .query("mediaJobs")
      .withIndex("by_asset", (q) => q.eq("asset", existing._id))
      .collect();
    for (const staleJob of staleJobs) {
      if (staleJob._id !== args.jobId && staleJob.state === "failed") {
        await ctx.db.patch("mediaJobs", staleJob._id, { asset: undefined });
        for (const association of await ctx.db
          .query("roomMedia")
          .withIndex("by_job", (q) => q.eq("job", staleJob._id))
          .collect()) {
          if (association.asset === existing._id) {
            await ctx.db.patch("roomMedia", association._id, {
              asset: undefined,
            });
          }
        }
      }
    }
    await deleteAssetEnrichment(ctx, existing._id);
    await deleteAssetArtifacts(ctx, existing);
    await ctx.db.patch("mediaAssets", existing._id, {
      activeJob: args.jobId,
      state: "processing",
      annotationsState: "processing",
      annotationsError: undefined,
      sourceArtifactId: undefined,
      extractedAudioArtifactId: undefined,
      instrumentalArtifactId: undefined,
      vocalsArtifactId: undefined,
      finalArtifactId: undefined,
      melodyArtifactId: undefined,
      annotationsArtifactId: undefined,
      midiArtifactId: undefined,
      musicXmlArtifactId: undefined,
      title: args.title,
      duration: args.duration,
      updatedAt: now,
    });
    await deleteLyricTracks(ctx, existing._id);
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
  {
    jobId,
    kind,
    artifactId,
    secondaryArtifactId,
    tertiaryArtifactId,
  }: {
    jobId: Id<"mediaJobs">;
    kind: OperationKind;
    artifactId: ArtifactId;
    secondaryArtifactId?: ArtifactId;
    tertiaryArtifactId?: ArtifactId;
  },
) {
  const { asset } = await requireOwnedAsset(ctx, jobId);
  const patch =
    kind === "download"
      ? { sourceArtifactId: artifactId }
      : kind === "extractAudio"
        ? { extractedAudioArtifactId: artifactId }
        : kind === "separate"
          ? {
              instrumentalArtifactId: artifactId,
              vocalsArtifactId: secondaryArtifactId,
            }
          : kind === "analyzeMelody"
            ? { melodyArtifactId: artifactId }
            : kind === "assembleAnnotations"
              ? {
                  annotationsArtifactId: artifactId,
                  midiArtifactId: secondaryArtifactId,
                  musicXmlArtifactId: tertiaryArtifactId,
                  annotationsState: "ready" as const,
                  annotationsError: undefined,
                }
              : kind === "mux"
                ? { finalArtifactId: artifactId }
                : {};
  await ctx.db.patch("mediaAssets", asset._id, {
    ...patch,
    updatedAt: Date.now(),
  });
}

async function markJobReady(ctx: MutationCtx, jobId: Id<"mediaJobs">, assetId: Id<"mediaAssets">) {
  const job = await requireJob(ctx, jobId);
  if (job.asset && job.asset !== assetId) {
    throw new Error("Media job references a different asset");
  }
  await ctx.db.patch("mediaJobs", jobId, {
    state: "ready",
    stage: "ready",
    progress: 1,
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
  const { asset } = await requireOwnedAsset(ctx, jobId);
  if (!asset.finalArtifactId) throw new Error("Media asset is missing its final video");
  await ctx.db.patch("mediaAssets", asset._id, {
    state: "ready",
    activeJob: undefined,
    updatedAt: Date.now(),
  });
  const jobs = await ctx.db
    .query("mediaJobs")
    .withIndex("by_asset", (q) => q.eq("asset", asset._id))
    .collect();
  for (const waitingJob of jobs) {
    if (waitingJob.state !== "queued" && waitingJob.state !== "processing") continue;
    await markJobReady(ctx, waitingJob._id, asset._id);
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
  if (!job || job.state === "ready") return;
  await ctx.db.patch("mediaJobs", args.jobId, {
    state: "failed",
    stage: "failed",
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
