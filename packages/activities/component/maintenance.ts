import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { protocolVersion } from "./validators";

const MAX_BATCH_SIZE = 100;
const issue = v.object({ id: v.string(), reason: v.string() });
const pageResult = v.object({
  continueCursor: v.string(),
  isDone: v.boolean(),
  scanned: v.number(),
  changed: v.number(),
  issues: v.array(issue),
});

function batchSize(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_BATCH_SIZE)
    throw new Error(`limit must be between 1 and ${MAX_BATCH_SIZE}`);
  return value;
}

export const preflightActivities = query({
  args: { cursor: v.union(v.string(), v.null()), limit: v.number() },
  returns: v.object({
    continueCursor: v.string(),
    isDone: v.boolean(),
    scanned: v.number(),
    legacy: v.number(),
    active: v.array(v.string()),
    activeV1: v.array(v.string()),
    pendingDeliveries: v.array(v.string()),
    workflowIds: v.array(v.string()),
    issues: v.array(issue),
  }),
  handler: async (ctx, args) => {
    const cursor = args.cursor ? ctx.db.normalizeId("activities", args.cursor) : null;
    const rows = await ctx.db
      .query("activities")
      .withIndex("by_id", cursor ? (q) => q.gt("_id", cursor) : undefined)
      .take(batchSize(args.limit) + 1);
    const isDone = rows.length <= args.limit;
    const page = rows.slice(0, args.limit);
    const active: string[] = [];
    const activeV1: string[] = [];
    const pendingDeliveries: string[] = [];
    const workflowIds = new Set<string>();
    const issues: Array<{ id: string; reason: string }> = [];
    let legacy = 0;
    for (const activity of page) {
      if (!("outputSchema" in activity)) legacy += 1;
      if (activity.state === "scheduled" || activity.state === "running") {
        active.push(activity._id);
        if (activity.protocolVersion < protocolVersion) activeV1.push(activity._id);
      }
      if (activity.deliveryState === "pending") {
        pendingDeliveries.push(activity._id);
        if (activity.protocolVersion < protocolVersion && !activeV1.includes(activity._id))
          activeV1.push(activity._id);
      }
      if (!activity.artifactScopeId) {
        issues.push({ id: activity._id, reason: "activity has no artifact scope" });
        continue;
      }
      const scope = await ctx.db.get(activity.artifactScopeId);
      if (!scope) issues.push({ id: activity._id, reason: "activity scope is missing" });
      else if (scope.workflowId) workflowIds.add(scope.workflowId);
      if (
        (activity.state === "completed" ||
          activity.state === "failed" ||
          activity.state === "canceled") &&
        (!activity.result || !activity.completedAt)
      )
        issues.push({ id: activity._id, reason: "terminal activity has no result or timestamp" });
    }
    return {
      continueCursor: page[page.length - 1]?._id ?? args.cursor ?? "",
      isDone,
      scanned: page.length,
      legacy,
      active,
      activeV1,
      pendingDeliveries,
      workflowIds: [...workflowIds],
      issues,
    };
  },
});

export const inspectArtifacts = query({
  args: { artifactIds: v.array(v.string()) },
  returns: v.array(
    v.object({
      artifactId: v.string(),
      found: v.boolean(),
      scopeId: v.optional(v.string()),
      workflowId: v.optional(v.string()),
      activityId: v.optional(v.string()),
      attempt: v.optional(v.number()),
      slot: v.optional(v.string()),
      disposition: v.optional(v.union(v.literal("intermediate"), v.literal("retained"))),
      state: v.optional(v.union(v.literal("staged"), v.literal("adopted"))),
      owner: v.optional(v.string()),
      storageId: v.optional(v.string()),
      storageExists: v.boolean(),
    }),
  ),
  handler: async (ctx, { artifactIds }) => {
    if (artifactIds.length > MAX_BATCH_SIZE) throw new Error("Too many artifact IDs");
    return await Promise.all(
      artifactIds.map(async (value) => {
        const artifactId = ctx.db.normalizeId("artifacts", value);
        const artifact = artifactId ? await ctx.db.get(artifactId) : null;
        if (!artifact) return { artifactId: value, found: false, storageExists: false };
        const scope = await ctx.db.get(artifact.scopeId);
        return {
          artifactId: value,
          found: true,
          scopeId: artifact.scopeId,
          workflowId: scope?.workflowId,
          activityId: artifact.activityId,
          attempt: artifact.attempt,
          slot: artifact.slot,
          disposition: artifact.disposition,
          state: artifact.state,
          owner:
            "owner" in artifact && typeof artifact.owner === "string" ? artifact.owner : undefined,
          storageId: artifact.storageId,
          storageExists: !!(await ctx.db.system.get("_storage", artifact.storageId)),
        };
      }),
    );
  },
});

export const adoptArtifacts = mutation({
  args: {
    dryRun: v.boolean(),
    references: v.array(
      v.object({ artifactId: v.string(), owner: v.string(), slot: v.optional(v.string()) }),
    ),
  },
  returns: v.object({ changed: v.number(), issues: v.array(issue) }),
  handler: async (ctx, { dryRun, references }) => {
    if (references.length > MAX_BATCH_SIZE) throw new Error("Too many artifact references");
    let changed = 0;
    const issues: Array<{ id: string; reason: string }> = [];
    for (const reference of references) {
      const artifactId = ctx.db.normalizeId("artifacts", reference.artifactId);
      const artifact = artifactId ? await ctx.db.get(artifactId) : null;
      if (!artifact) {
        issues.push({ id: reference.artifactId, reason: "artifact is missing" });
        continue;
      }
      if (artifact.disposition !== "retained") {
        issues.push({ id: reference.artifactId, reason: "artifact is not retained" });
        continue;
      }
      if (reference.slot && artifact.slot !== reference.slot) {
        issues.push({ id: reference.artifactId, reason: `expected slot ${reference.slot}` });
        continue;
      }
      if (!(await ctx.db.system.get("_storage", artifact.storageId))) {
        issues.push({ id: reference.artifactId, reason: "artifact storage is missing" });
        continue;
      }
      if (artifact.state === "adopted" && "owner" in artifact && artifact.owner) {
        if (artifact.owner !== reference.owner)
          issues.push({ id: reference.artifactId, reason: "artifact has another owner" });
        continue;
      }
      changed += 1;
      if (!dryRun)
        await ctx.db.patch(artifact._id, {
          state: "adopted",
          owner: reference.owner,
          updatedAt: Date.now(),
        });
    }
    return { changed, issues };
  },
});

export const migrateActivities = mutation({
  args: { cursor: v.union(v.string(), v.null()), limit: v.number(), dryRun: v.boolean() },
  returns: pageResult,
  handler: async (ctx, args) => {
    const cursor = args.cursor ? ctx.db.normalizeId("activities", args.cursor) : null;
    const rows = await ctx.db
      .query("activities")
      .withIndex("by_id", cursor ? (q) => q.gt("_id", cursor) : undefined)
      .take(batchSize(args.limit) + 1);
    const isDone = rows.length <= args.limit;
    const page = rows.slice(0, args.limit);
    const issues: Array<{ id: string; reason: string }> = [];
    let changed = 0;
    for (const activity of page) {
      if ("outputSchema" in activity) continue;
      if (
        activity.state === "scheduled" ||
        activity.state === "running" ||
        activity.deliveryState === "pending"
      )
        continue;
      if (!activity.artifactScopeId) {
        issues.push({ id: activity._id, reason: "activity has no artifact scope" });
        continue;
      }
      const scope = await ctx.db.get(activity.artifactScopeId);
      if (!scope) {
        issues.push({ id: activity._id, reason: "activity scope is missing" });
        continue;
      }
      const artifacts = await ctx.db
        .query("artifacts")
        .withIndex("by_activity_and_attempt", (q) => q.eq("activityId", activity._id))
        .take(MAX_BATCH_SIZE + 1);
      if (artifacts.length > MAX_BATCH_SIZE) {
        issues.push({ id: activity._id, reason: "activity has more than 100 artifacts" });
        continue;
      }
      const now = Date.now();
      if (!activity.result || !activity.completedAt) {
        issues.push({ id: activity._id, reason: "terminal activity has no result or timestamp" });
        continue;
      }
      changed += 1;
      if (!args.dryRun)
        await ctx.db.replace(activity._id, {
          protocolVersion,
          activityType: activity.activityType,
          activityVersion: activity.activityVersion,
          taskQueue: activity.taskQueue,
          input: activity.input,
          outputSchema: {
            kind: "object",
            fields: Object.fromEntries(
              artifacts.map((artifact) => [
                artifact.slot,
                { kind: "artifact", disposition: artifact.disposition },
              ]),
            ),
          },
          artifactScopeId: activity.artifactScopeId,
          artifactSlots: activity.artifactSlots,
          artifactDefinitions: activity.artifactDefinitions,
          completion: activity.completion,
          retryPolicy: activity.retryPolicy,
          startToCloseTimeoutMs: activity.startToCloseTimeoutMs,
          scheduleToCloseTimeoutMs: activity.scheduleToCloseTimeoutMs,
          scheduleDeadline: activity.scheduleDeadline,
          nextAttemptAt: activity.nextAttemptAt,
          attempt: activity.attempt,
          cancelRequested: activity.cancelRequested,
          progress: activity.progress,
          progressMessage: activity.progressMessage,
          heartbeatDetails: activity.heartbeatDetails,
          result: activity.result,
          deliveryState: activity.deliveryState,
          deliveryAttempts: activity.deliveryAttempts,
          deliveryError: activity.deliveryError,
          lastErrorType: activity.lastErrorType,
          lastErrorMessage: activity.lastErrorMessage,
          createdAt: activity.createdAt,
          startedAt: activity.startedAt,
          updatedAt: now,
          completedAt: activity.completedAt,
          state: activity.state,
        });
    }
    return {
      continueCursor: page[page.length - 1]?._id ?? args.cursor ?? "",
      isDone,
      scanned: page.length,
      changed,
      issues,
    };
  },
});

export const migrateWorkflowSteps = mutation({
  args: { cursor: v.union(v.string(), v.null()), limit: v.number(), dryRun: v.boolean() },
  returns: pageResult,
  handler: async (ctx, args) => {
    const cursor = args.cursor ? ctx.db.normalizeId("workflowSteps", args.cursor) : null;
    const rows = await ctx.db
      .query("workflowSteps")
      .withIndex("by_id", cursor ? (q) => q.gt("_id", cursor) : undefined)
      .take(batchSize(args.limit) + 1);
    const isDone = rows.length <= args.limit;
    const page = rows.slice(0, args.limit);
    let changed = 0;
    for (const step of page) {
      if (!("state" in step)) continue;
      changed += 1;
      if (!args.dryRun)
        await ctx.db.replace(step._id, {
          workflowId: step.workflowId,
          key: step.key,
          label: step.label,
          position: step.position,
          kind: step.kind,
        });
    }
    return {
      continueCursor: page[page.length - 1]?._id ?? args.cursor ?? "",
      isDone,
      scanned: page.length,
      changed,
      issues: [],
    };
  },
});

export const abandonScopes = mutation({
  args: { dryRun: v.boolean(), workflowIds: v.array(v.string()) },
  returns: v.object({ changed: v.number(), issues: v.array(issue) }),
  handler: async (ctx, { dryRun, workflowIds }) => {
    if (workflowIds.length > MAX_BATCH_SIZE) throw new Error("Too many workflow IDs");
    let changed = 0;
    const issues: Array<{ id: string; reason: string }> = [];
    for (const workflowId of workflowIds) {
      const scope = await ctx.db
        .query("artifactScopes")
        .withIndex("by_workflow_id", (q) => q.eq("workflowId", workflowId))
        .unique();
      if (!scope) {
        issues.push({ id: workflowId, reason: "workflow scope is missing" });
        continue;
      }
      if (scope.state !== "open") continue;
      changed += 1;
      if (!dryRun) await ctx.db.patch(scope._id, { state: "abandoned", updatedAt: Date.now() });
    }
    return { changed, issues };
  },
});

export const finalizeWorkflow = mutation({
  args: { workflowId: v.string(), dryRun: v.boolean() },
  returns: v.object({
    done: v.boolean(),
    deletedArtifacts: v.number(),
    deletedActivities: v.number(),
    deletedAttempts: v.number(),
    deletedSteps: v.number(),
    issues: v.array(issue),
  }),
  handler: async (ctx, { workflowId, dryRun }) => {
    const scope = await ctx.db
      .query("artifactScopes")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", workflowId))
      .unique();
    let deletedArtifacts = 0;
    let deletedActivities = 0;
    let deletedAttempts = 0;
    let deletedSteps = 0;
    const issues: Array<{ id: string; reason: string }> = [];

    const steps = await ctx.db
      .query("workflowSteps")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", workflowId))
      .take(MAX_BATCH_SIZE);
    deletedSteps = steps.length;
    if (!dryRun) for (const step of steps) await ctx.db.delete(step._id);
    if (steps.length === MAX_BATCH_SIZE)
      return {
        done: false,
        deletedArtifacts,
        deletedActivities,
        deletedAttempts,
        deletedSteps,
        issues,
      };

    if (!scope)
      return {
        done: true,
        deletedArtifacts,
        deletedActivities,
        deletedAttempts,
        deletedSteps,
        issues,
      };
    if (scope.state === "open") {
      issues.push({ id: scope._id, reason: "scope is still open" });
      return {
        done: false,
        deletedArtifacts,
        deletedActivities,
        deletedAttempts,
        deletedSteps,
        issues,
      };
    }

    const staged = await ctx.db
      .query("artifacts")
      .withIndex("by_scope_and_state", (q) => q.eq("scopeId", scope._id).eq("state", "staged"))
      .take(MAX_BATCH_SIZE);
    deletedArtifacts = staged.length;
    if (!dryRun)
      for (const artifact of staged) {
        await ctx.storage.delete(artifact.storageId);
        await ctx.db.delete(artifact._id);
      }
    if (staged.length === MAX_BATCH_SIZE)
      return {
        done: false,
        deletedArtifacts,
        deletedActivities,
        deletedAttempts,
        deletedSteps,
        issues,
      };

    const activities = await ctx.db
      .query("activities")
      .withIndex("by_scope", (q) => q.eq("artifactScopeId", scope._id))
      .take(MAX_BATCH_SIZE);
    for (const activity of activities) {
      const retained = await ctx.db
        .query("artifacts")
        .withIndex("by_activity_and_attempt", (q) => q.eq("activityId", activity._id))
        .first();
      if (retained) continue;
      const attempts = await ctx.db
        .query("attempts")
        .withIndex("by_activity", (q) => q.eq("activityId", activity._id))
        .take(MAX_BATCH_SIZE + 1);
      if (attempts.length > MAX_BATCH_SIZE) {
        issues.push({ id: activity._id, reason: "activity has more than 100 attempts" });
        continue;
      }
      deletedActivities += 1;
      deletedAttempts += attempts.length;
      if (!dryRun) {
        for (const attempt of attempts) await ctx.db.delete(attempt._id);
        await ctx.db.delete(activity._id);
      }
    }
    const remainingArtifact = await ctx.db
      .query("artifacts")
      .withIndex("by_scope_and_state", (q) => q.eq("scopeId", scope._id))
      .first();
    const remainingActivity = dryRun
      ? activities.length > deletedActivities
      : await ctx.db
          .query("activities")
          .withIndex("by_scope", (q) => q.eq("artifactScopeId", scope._id))
          .first();
    const done = !remainingArtifact && !remainingActivity && issues.length === 0;
    if (done && !dryRun) await ctx.db.delete(scope._id);
    return { done, deletedArtifacts, deletedActivities, deletedAttempts, deletedSteps, issues };
  },
});
