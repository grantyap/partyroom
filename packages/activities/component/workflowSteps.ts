import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";

const stepKind = v.union(v.literal("activity"), v.literal("workflow"));
const stepState = v.union(
  v.literal("pending"),
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled"),
  v.literal("skipped"),
);

const stepDefinition = v.object({
  key: v.string(),
  label: v.string(),
  position: v.number(),
  kind: stepKind,
});

const stepSnapshot = v.object({
  key: v.string(),
  label: v.string(),
  position: v.number(),
  kind: stepKind,
  state: stepState,
  activityId: v.optional(v.string()),
  progress: v.number(),
  message: v.optional(v.string()),
  error: v.optional(v.string()),
  attempt: v.optional(v.number()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
});

async function requireStep(ctx: MutationCtx, workflowId: string, key: string) {
  const step = await ctx.db
    .query("workflowSteps")
    .withIndex("by_workflow_id_and_key", (q) => q.eq("workflowId", workflowId).eq("key", key))
    .unique();
  if (!step) throw new Error(`Workflow step ${key} is not registered`);
  return step;
}

export const register = mutation({
  args: {
    workflowId: v.string(),
    steps: v.array(stepDefinition),
  },
  returns: v.null(),
  handler: async (ctx, { workflowId, steps }) => {
    const existing = await ctx.db
      .query("workflowSteps")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", workflowId))
      .take(100);
    if (existing.length > 0) {
      const byKey = new Map(existing.map((step) => [step.key, step]));
      for (const definition of steps) {
        const step = byKey.get(definition.key);
        if (
          !step ||
          step.label !== definition.label ||
          step.position !== definition.position ||
          step.kind !== definition.kind
        ) {
          throw new Error(`Workflow step definition changed for ${definition.key}`);
        }
      }
      return null;
    }

    const now = Date.now();
    for (const step of steps) {
      await ctx.db.insert("workflowSteps", {
        workflowId,
        ...step,
        state: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});

export const linkActivity = mutation({
  args: {
    workflowId: v.string(),
    key: v.string(),
    activityId: v.id("activities"),
  },
  returns: v.null(),
  handler: async (ctx, { workflowId, key, activityId }) => {
    const step = await requireStep(ctx, workflowId, key);
    if (step.kind !== "activity") throw new Error(`Workflow step ${key} is not an activity`);
    if (step.activityId && step.activityId !== activityId) {
      throw new Error(`Workflow step ${key} has already been run`);
    }
    if (!step.activityId && step.state !== "queued") {
      throw new Error(`Workflow step ${key} was not started`);
    }
    const activity = await ctx.db.get(activityId);
    if (!activity) throw new Error("Activity not found");
    const state =
      activity.state === "scheduled"
        ? "queued"
        : activity.state === "running"
          ? "running"
          : activity.state;
    await ctx.db.patch(step._id, {
      activityId,
      state,
      startedAt: activity.startedAt,
      completedAt: activity.completedAt,
      error:
        activity.result?.kind === "failed"
          ? activity.result.errorMessage.slice(0, 2_000)
          : undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const startActivity = mutation({
  args: {
    workflowId: v.string(),
    key: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { workflowId, key }) => {
    const step = await requireStep(ctx, workflowId, key);
    if (step.kind !== "activity") throw new Error(`Workflow step ${key} is not an activity`);
    if (step.state !== "pending") throw new Error(`Workflow step ${key} has already been run`);
    await ctx.db.patch(step._id, {
      state: "queued",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const failActivity = mutation({
  args: {
    workflowId: v.string(),
    key: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { workflowId, key, error }) => {
    const step = await requireStep(ctx, workflowId, key);
    if (step.kind !== "activity") throw new Error(`Workflow step ${key} is not an activity`);
    if (step.activityId) return null;
    const now = Date.now();
    await ctx.db.patch(step._id, {
      state: "failed",
      error: error.slice(0, 2_000),
      completedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const start = mutation({
  args: {
    workflowId: v.string(),
    key: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { workflowId, key }) => {
    const step = await requireStep(ctx, workflowId, key);
    if (step.kind !== "workflow") throw new Error(`Workflow step ${key} is an activity`);
    if (step.state !== "pending") throw new Error(`Workflow step ${key} has already been run`);
    const now = Date.now();
    await ctx.db.patch(step._id, {
      state: "running",
      startedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const finish = mutation({
  args: {
    workflowId: v.string(),
    key: v.string(),
    state: v.union(v.literal("completed"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { workflowId, key, state, error }) => {
    const step = await requireStep(ctx, workflowId, key);
    if (step.kind !== "workflow") throw new Error(`Workflow step ${key} is an activity`);
    if (step.state !== "running") throw new Error(`Workflow step ${key} is not running`);
    const now = Date.now();
    await ctx.db.patch(step._id, {
      state,
      completedAt: now,
      error: error?.slice(0, 2_000),
      updatedAt: now,
    });
    return null;
  },
});

export const skip = mutation({
  args: {
    workflowId: v.string(),
    key: v.string(),
    message: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { workflowId, key, message }) => {
    const step = await requireStep(ctx, workflowId, key);
    if (step.state !== "pending") throw new Error(`Workflow step ${key} has already been run`);
    const now = Date.now();
    await ctx.db.patch(step._id, {
      state: "skipped",
      message: message?.slice(0, 2_000),
      completedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const finishActivity = mutation({
  args: {
    activityId: v.id("activities"),
    state: v.union(v.literal("completed"), v.literal("failed"), v.literal("canceled")),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { activityId, state, error }) => {
    const step = await ctx.db
      .query("workflowSteps")
      .withIndex("by_activity_id", (q) => q.eq("activityId", activityId))
      .unique();
    if (!step) return null;
    const activity = await ctx.db.get(activityId);
    const now = Date.now();
    await ctx.db.patch(step._id, {
      state,
      startedAt: activity?.startedAt ?? step.startedAt,
      completedAt: activity?.completedAt ?? now,
      error: error?.slice(0, 2_000),
      updatedAt: now,
    });
    return null;
  },
});

export const finalize = mutation({
  args: {
    workflowId: v.string(),
    succeeded: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { workflowId, succeeded }) => {
    const steps = await ctx.db
      .query("workflowSteps")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", workflowId))
      .take(100);
    const now = Date.now();
    for (const step of steps) {
      if (
        step.state === "completed" ||
        step.state === "failed" ||
        step.state === "canceled" ||
        step.state === "skipped"
      ) {
        continue;
      }
      if (succeeded && step.state !== "pending") continue;
      await ctx.db.patch(step._id, {
        state: succeeded ? "skipped" : "canceled",
        completedAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});

function snapshot(step: Doc<"workflowSteps">, activity: Doc<"activities"> | null) {
  const state =
    activity?.state === "scheduled"
      ? "queued"
      : activity?.state === "running"
        ? "running"
        : (activity?.state ?? step.state);
  return {
    key: step.key,
    label: step.label,
    position: step.position,
    kind: step.kind,
    state,
    activityId: step.activityId,
    progress:
      state === "completed" || state === "failed" || state === "canceled" || state === "skipped"
        ? 1
        : (activity?.progress ?? 0),
    message: activity?.progressMessage ?? step.message,
    error:
      activity?.result?.kind === "failed"
        ? activity.result.errorMessage
        : (step.error ?? undefined),
    attempt: activity?.attempt,
    startedAt: activity?.startedAt ?? step.startedAt,
    completedAt: activity?.completedAt ?? step.completedAt,
  };
}

export const list = query({
  args: {
    workflowId: v.string(),
  },
  returns: v.array(stepSnapshot),
  handler: async (ctx, { workflowId }) => {
    const steps = await ctx.db
      .query("workflowSteps")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", workflowId))
      .take(100);
    const snapshots = await Promise.all(
      steps.map(async (step) =>
        snapshot(step, step.activityId ? await ctx.db.get(step.activityId) : null),
      ),
    );
    return snapshots.sort((left, right) => left.position - right.position);
  },
});
