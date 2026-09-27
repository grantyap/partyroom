import { type WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { workflowStatus } from "../activities/workflowManager";

export const migrationId = "workflow-state-redesign-v1";
const MAX_PAGE_SIZE = 50;

const table = v.union(
  v.literal("mediaJobs"),
  v.literal("mediaAssets"),
  v.literal("mediaLyricTracks"),
  v.literal("mediaEnrichments"),
  v.literal("roomMedia"),
  v.literal("roomPlayback"),
);
const blocker = v.object({ table: v.string(), id: v.string(), reason: v.string() });
const artifactReference = v.object({
  artifactId: v.string(),
  owner: v.string(),
  slot: v.string(),
  source: v.string(),
});
const pageResult = v.object({
  continueCursor: v.string(),
  isDone: v.boolean(),
  scanned: v.number(),
  legacy: v.number(),
  blockers: v.array(blocker),
  workflowIds: v.array(v.string()),
  workflows: v.array(
    v.object({ workflowId: v.string(), version: v.union(v.literal(1), v.literal(2)) }),
  ),
  artifactReferences: v.array(artifactReference),
  cleanupArtifactIds: v.array(v.string()),
});

function pageSize(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE)
    throw new Error(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
  return value;
}

export const preflightPage = internalQuery({
  args: { table, cursor: v.union(v.string(), v.null()), limit: v.number() },
  returns: pageResult,
  handler: async (ctx, args) => {
    const pagination = { cursor: args.cursor, numItems: pageSize(args.limit) };
    const blockers: Array<{ table: string; id: string; reason: string }> = [];
    const workflowIds = new Set<string>();
    const workflows = new Map<string, 1 | 2>();
    const artifactReferences: Array<{
      artifactId: string;
      owner: string;
      slot: string;
      source: string;
    }> = [];
    const cleanupArtifactIds: string[] = [];
    let legacy = 0;
    const block = (id: string, reason: string) => blockers.push({ table: args.table, id, reason });
    const finish = (
      page: { continueCursor: string; isDone: boolean; page: unknown[] },
      ids: string[] = [],
    ) => ({
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      scanned: page.page.length,
      legacy,
      blockers,
      workflowIds: ids,
      workflows: ids.map((workflowId) => ({
        workflowId,
        version: workflows.get(workflowId) ?? 1,
      })),
      artifactReferences,
      cleanupArtifactIds,
    });

    if (args.table === "mediaJobs") {
      const page = await ctx.db.query("mediaJobs").paginate(pagination);
      for (const job of page.page) {
        if (
          "stage" in job ||
          "progress" in job ||
          "activeActivities" in job ||
          "stepTimings" in job
        )
          legacy += 1;
        if (job.workflowId) {
          workflowIds.add(job.workflowId);
          workflows.set(job.workflowId, job.workflowVersion ?? 1);
        }
        if (job.state === "ready" && (!job.asset || !job.workflowId))
          block(job._id, "ready job needs asset and workflowId");
        if (job.state === "failed" && (!job.errorCode || !job.errorMessage))
          block(job._id, "failed job needs errorCode and errorMessage");
        if (job.state === "canceled" && !job.errorMessage)
          block(job._id, "canceled job needs errorMessage");
      }
      return finish(page, [...workflowIds]);
    }

    if (args.table === "mediaAssets") {
      const page = await ctx.db.query("mediaAssets").paginate(pagination);
      const retained = [
        ["instrumentalArtifactId", "instrumentalArtifactId"],
        ["vocalsArtifactId", "vocalsArtifactId"],
        ["finalArtifactId", "artifactId"],
        ["annotationsArtifactId", "annotationsArtifactId"],
        ["midiArtifactId", "midiArtifactId"],
        ["musicXmlArtifactId", "musicXmlArtifactId"],
      ] as const;
      for (const asset of page.page) {
        if (asset.state === "processing" && !asset.activeJob)
          block(asset._id, "processing asset needs activeJob");
        if (asset.state === "ready" && (!asset.finalArtifactId || asset.activeJob))
          block(asset._id, "ready asset needs finalArtifactId and no activeJob");
        if (asset.state === "failed" && asset.activeJob)
          block(asset._id, "failed asset must not have activeJob");
        for (const [field, slot] of retained) {
          const artifactId = asset[field];
          if (artifactId)
            artifactReferences.push({
              artifactId,
              owner: asset._id,
              slot,
              source: `mediaAssets.${field}`,
            });
        }
        for (const artifactId of [
          asset.sourceArtifactId,
          asset.extractedAudioArtifactId,
          asset.melodyArtifactId,
        ])
          if (artifactId) cleanupArtifactIds.push(artifactId);
      }
      return finish(page);
    }

    if (args.table === "mediaLyricTracks") {
      const page = await ctx.db.query("mediaLyricTracks").paginate(pagination);
      for (const track of page.page) {
        if (!(await ctx.db.get(track.asset))) block(track._id, "lyric track asset is missing");
        if (track.state === "ready" && !track.observations?.length && !track.timedArtifactId)
          block(track._id, "ready lyric track needs observations or timedArtifactId");
        if (track.textArtifactId)
          artifactReferences.push({
            artifactId: track.textArtifactId,
            owner: track.asset,
            slot: "lyricsArtifactId",
            source: "mediaLyricTracks.textArtifactId",
          });
        if (track.timedArtifactId)
          artifactReferences.push({
            artifactId: track.timedArtifactId,
            owner: track.asset,
            slot: "timedLyricsArtifactId",
            source: "mediaLyricTracks.timedArtifactId",
          });
      }
      return finish(page);
    }

    if (args.table === "mediaEnrichments") {
      const page = await ctx.db.query("mediaEnrichments").paginate(pagination);
      for (const enrichment of page.page) {
        if ("activeActivities" in enrichment || "stepTimings" in enrichment) legacy += 1;
        if (enrichment.workflowId) {
          workflowIds.add(enrichment.workflowId);
          workflows.set(enrichment.workflowId, enrichment.workflowVersion ?? 1);
        }
        if (enrichment.state !== "queued" && !enrichment.workflowId)
          block(enrichment._id, "non-queued enrichment needs workflowId");
        if ((enrichment.state === "failed" || enrichment.state === "canceled") && !enrichment.error)
          block(enrichment._id, `${enrichment.state} enrichment needs error`);
      }
      return finish(page, [...workflowIds]);
    }

    if (args.table === "roomMedia") {
      const page = await ctx.db.query("roomMedia").paginate(pagination);
      for (const association of page.page) {
        if (!(await ctx.db.get(association.job)))
          block(association._id, "room media job is missing");
        if (association.asset && !(await ctx.db.get(association.asset)))
          block(association._id, "room media asset is missing");
        if (
          association.selectedLyricsId &&
          !ctx.db.normalizeId("mediaLyricTracks", association.selectedLyricsId)
        )
          block(association._id, "selected lyric track ID is invalid");
      }
      return finish(page);
    }

    const page = await ctx.db.query("roomPlayback").paginate(pagination);
    for (const playback of page.page) {
      const items = [
        ...(playback.state.kind === "occupiedPlaying" || playback.state.kind === "occupiedPaused"
          ? [playback.state.current]
          : playback.state.kind === "empty" && playback.state.transport.kind !== "idle"
            ? [playback.state.transport.current]
            : []),
        ...playback.state.queue,
      ];
      for (const item of items) {
        if (!(await ctx.db.get(item.roomMedia)))
          block(playback._id, `playback item ${item.key} has no roomMedia`);
        if (item.kind === "ready" && !(await ctx.db.get(item.asset)))
          block(playback._id, `ready playback item ${item.key} has no asset`);
      }
    }
    return finish(page);
  },
});

export const getState = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      phase: v.string(),
      activityCursor: v.optional(v.string()),
      workflowStepCursor: v.optional(v.string()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const state = await ctx.db
      .query("migrationRuns")
      .withIndex("by_migration_id", (q) => q.eq("migrationId", migrationId))
      .unique();
    return state
      ? {
          phase: state.phase,
          activityCursor: state.activityCursor,
          workflowStepCursor: state.workflowStepCursor,
          updatedAt: state.updatedAt,
        }
      : null;
  },
});

export const setState = internalMutation({
  args: {
    phase: v.union(
      v.literal("preflight"),
      v.literal("apply"),
      v.literal("verify"),
      v.literal("finalize"),
      v.literal("complete"),
    ),
    activityCursor: v.optional(v.string()),
    workflowStepCursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("migrationRuns")
      .withIndex("by_migration_id", (q) => q.eq("migrationId", migrationId))
      .unique();
    const value = { ...args, migrationId, updatedAt: Date.now() };
    if (state) await ctx.db.patch(state._id, value);
    else await ctx.db.insert("migrationRuns", value);
    return null;
  },
});

export const setRoutingVersion = internalMutation({
  args: { version: v.union(v.literal(1), v.literal(2)) },
  returns: v.null(),
  handler: async (ctx, { version }) => {
    const state = await ctx.db
      .query("migrationRuns")
      .withIndex("by_migration_id", (q) => q.eq("migrationId", migrationId))
      .unique();
    const value = { routingVersion: version, updatedAt: Date.now() };
    if (state) await ctx.db.patch(state._id, value);
    else
      await ctx.db.insert("migrationRuns", {
        migrationId,
        phase: "preflight",
        ...value,
      });
    return null;
  },
});

export const getRoutingVersion = internalQuery({
  args: {},
  returns: v.union(v.literal(1), v.literal(2)),
  handler: async (ctx) => {
    const state = await ctx.db
      .query("migrationRuns")
      .withIndex("by_migration_id", (q) => q.eq("migrationId", migrationId))
      .unique();
    return state?.routingVersion ?? 1;
  },
});

const invariantCounts = v.object({
  blockers: v.number(),
  legacy: v.number(),
  activeV1Workflows: v.number(),
  activeV1Activities: v.number(),
  pendingAdoptions: v.number(),
});

export const persistVerification = internalMutation({
  args: { generation: v.string(), counts: invariantCounts, dataWatermark: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const clean = Object.values(args.counts).every((count) => count === 0);
    await ctx.db.insert("migrationVerifications", {
      migrationId,
      generation: args.generation,
      completedAt: Date.now(),
      clean,
      invariantCounts: args.counts,
      dataWatermark: args.dataWatermark,
    });
    return null;
  },
});

export const authorizeFinalize = internalQuery({
  args: { generation: v.string(), dataWatermark: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const latest = await ctx.db
      .query("migrationVerifications")
      .withIndex("by_migration_id", (q) => q.eq("migrationId", migrationId))
      .order("desc")
      .take(2);
    if (latest.length < 2 || latest.some((verification) => !verification.clean))
      throw new Error("two clean server-side verification generations are required");
    if (latest[0].generation !== args.generation || latest[0].dataWatermark !== args.dataWatermark)
      throw new Error("verification generation is stale or does not match the current scan");
    if (latest[0].completedAt - latest[1].completedAt < 5 * 60_000)
      throw new Error("verification passes must be at least five minutes apart");
    if (Date.now() - latest[0].completedAt > 30 * 60_000)
      throw new Error("verification is older than thirty minutes");
    const state = await ctx.db
      .query("migrationRuns")
      .withIndex("by_migration_id", (q) => q.eq("migrationId", migrationId))
      .unique();
    if (state?.routingVersion !== 2) throw new Error("new work is not routed to v2");
    return null;
  },
});

export const workflowStatuses = internalQuery({
  args: { workflowIds: v.array(v.string()) },
  returns: v.array(v.object({ workflowId: v.string(), status: v.string() })),
  handler: async (ctx, { workflowIds }) => {
    if (workflowIds.length > MAX_PAGE_SIZE) throw new Error("Too many workflow IDs");
    return await Promise.all(
      workflowIds.map(async (id) => {
        try {
          return { workflowId: id, status: (await workflowStatus(ctx, id as WorkflowId)).type };
        } catch {
          return { workflowId: id, status: "missing" };
        }
      }),
    );
  },
});
