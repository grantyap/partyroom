import type { FunctionHandle } from "convex/server";
import { v, compareValues, type Value } from "convex/values";
import { parseWire, wireArtifactDefinitions, type WireSchema } from "../src/wire";
import { currentLease, attemptForToken } from "./leases";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import {
  activityDefinition,
  artifactSlot,
  completion,
  completionResult,
  protocolVersion,
  retryPolicy,
} from "./validators";

const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 5 * 60_000;
const DELIVERY_RETRY_MAX_MS = 5 * 60_000;
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60_000;

type Activity = Doc<"activities">;
type TerminalResult =
  | { kind: "success"; value: unknown }
  | { kind: "failed"; errorType: string; errorMessage: string }
  | { kind: "canceled" };

const scheduleArgs = {
  activityType: v.string(),
  activityVersion: v.number(),
  taskQueue: v.string(),
  queue: v.object({
    leaseDurationMs: v.number(),
    maxConcurrentActivities: v.optional(v.number()),
  }),
  input: v.any(),
  inputSchema: v.any(),
  outputSchema: v.any(),
  artifactScopeId: v.id("artifactScopes"),
  completion: v.optional(completion),
  retryPolicy,
  startToCloseTimeoutMs: v.number(),
  scheduleToCloseTimeoutMs: v.number(),
};

function requirePositiveInteger(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function validateSchedule(args: {
  activityType: string;
  activityVersion: number;
  taskQueue: string;
  queue: { leaseDurationMs: number; maxConcurrentActivities?: number };
  retryPolicy: {
    maximumAttempts: number;
    initialIntervalMs: number;
    backoffCoefficient: number;
    maximumIntervalMs: number;
    nonRetryableErrorTypes: string[];
  };
  startToCloseTimeoutMs: number;
  scheduleToCloseTimeoutMs: number;
}) {
  if (!args.activityType.trim()) throw new Error("activityType must not be empty");
  if (!args.taskQueue.trim()) throw new Error("taskQueue must not be empty");
  requirePositiveInteger("activityVersion", args.activityVersion);
  requirePositiveInteger("maximumAttempts", args.retryPolicy.maximumAttempts);
  requirePositiveInteger("initialIntervalMs", args.retryPolicy.initialIntervalMs);
  requirePositiveInteger("maximumIntervalMs", args.retryPolicy.maximumIntervalMs);
  requirePositiveInteger("startToCloseTimeoutMs", args.startToCloseTimeoutMs);
  requirePositiveInteger("scheduleToCloseTimeoutMs", args.scheduleToCloseTimeoutMs);
  if (
    !Number.isFinite(args.retryPolicy.backoffCoefficient) ||
    args.retryPolicy.backoffCoefficient < 1
  ) {
    throw new Error("backoffCoefficient must be at least 1");
  }
  if (
    !Number.isSafeInteger(args.queue.leaseDurationMs) ||
    args.queue.leaseDurationMs < MIN_LEASE_MS ||
    args.queue.leaseDurationMs > MAX_LEASE_MS
  ) {
    throw new Error(`leaseDurationMs must be between ${MIN_LEASE_MS} and ${MAX_LEASE_MS}`);
  }
  if (args.queue.maxConcurrentActivities !== undefined) {
    requirePositiveInteger("maxConcurrentActivities", args.queue.maxConcurrentActivities);
  }
}

async function ensureQueue(
  ctx: MutationCtx,
  args: {
    name: string;
    leaseDurationMs: number;
    maxConcurrentActivities?: number;
  },
) {
  const now = Date.now();
  const existing = await ctx.db
    .query("queues")
    .withIndex("by_name", (q) => q.eq("name", args.name))
    .unique();
  if (!existing) {
    await ctx.db.insert("queues", { ...args, createdAt: now, updatedAt: now });
    return;
  }
  if (
    existing.leaseDurationMs !== args.leaseDurationMs ||
    existing.maxConcurrentActivities !== args.maxConcurrentActivities
  ) {
    await ctx.db.patch(existing._id, {
      leaseDurationMs: args.leaseDurationMs,
      maxConcurrentActivities: args.maxConcurrentActivities,
      updatedAt: now,
    });
  }
}

export const schedule = mutation({
  args: scheduleArgs,
  returns: v.id("activities"),
  handler: async (ctx, args) => {
    validateSchedule(args);
    parseWire(args.inputSchema as WireSchema, args.input);
    const scope = args.artifactScopeId ? await ctx.db.get(args.artifactScopeId) : null;
    if (!scope || scope.state !== "open" || scope.expiresAt <= Date.now())
      throw new Error("Artifact scope is not open");
    await ensureQueue(ctx, { name: args.taskQueue, ...args.queue });
    const now = Date.now();
    const scheduleDeadline = now + args.scheduleToCloseTimeoutMs;
    const activityId = await ctx.db.insert("activities", {
      protocolVersion,
      activityType: args.activityType,
      activityVersion: args.activityVersion,
      taskQueue: args.taskQueue,
      state: "scheduled",
      input: args.input,
      outputSchema: args.outputSchema,
      artifactScopeId: args.artifactScopeId,
      artifactSlots: Object.keys(wireArtifactDefinitions(args.outputSchema)),
      artifactDefinitions: Object.entries(
        wireArtifactDefinitions(args.outputSchema) as Record<
          string,
          { disposition: "retained" | "intermediate" }
        >,
      ).map(([slot, definition]) => ({ slot, ...definition })),
      completion: args.completion,
      retryPolicy: args.retryPolicy,
      startToCloseTimeoutMs: args.startToCloseTimeoutMs,
      scheduleToCloseTimeoutMs: args.scheduleToCloseTimeoutMs,
      scheduleDeadline,
      nextAttemptAt: now,
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAt(scheduleDeadline, internal.activities.watchdog, { activityId });
    return activityId;
  },
});

const claimResult = v.union(
  v.null(),
  v.object({
    protocolVersion: v.number(),
    activityId: v.id("activities"),
    activityType: v.string(),
    activityVersion: v.number(),
    taskQueue: v.string(),
    attempt: v.number(),
    attemptToken: v.string(),
    leaseExpiresAt: v.number(),
    attemptDeadline: v.number(),
    scheduleDeadline: v.number(),
    input: v.any(),
    artifactSlots: v.array(artifactSlot),
  }),
);

export const claim = mutation({
  args: {
    protocolVersion: v.literal(protocolVersion),
    taskQueue: v.string(),
    workerId: v.string(),
    supportedActivities: v.array(activityDefinition),
  },
  returns: claimResult,
  handler: async (ctx, args) => {
    if (!args.workerId.trim()) throw new Error("workerId must not be empty");
    const queue = await ctx.db
      .query("queues")
      .withIndex("by_name", (q) => q.eq("name", args.taskQueue))
      .unique();
    if (!queue) return null;

    const supported = new Set(
      args.supportedActivities.map(({ name, version }) => `${name}:${version}`),
    );
    const existingLease = await ctx.db
      .query("activities")
      .withIndex("by_worker_state", (q) => q.eq("workerId", args.workerId).eq("state", "running"))
      .first();
    if (
      existingLease?.leaseToken &&
      existingLease.leaseExpiresAt &&
      existingLease.attemptDeadline &&
      existingLease.taskQueue === args.taskQueue &&
      existingLease.leaseExpiresAt > Date.now() &&
      supported.has(`${existingLease.activityType}:${existingLease.activityVersion}`)
    ) {
      return claimedActivity(existingLease, {
        leaseToken: existingLease.leaseToken,
        leaseExpiresAt: existingLease.leaseExpiresAt,
        attemptDeadline: existingLease.attemptDeadline,
      });
    }

    if (queue.maxConcurrentActivities !== undefined) {
      const running = await ctx.db
        .query("activities")
        .withIndex("by_queue_state", (q) =>
          q.eq("taskQueue", args.taskQueue).eq("state", "running"),
        )
        .take(queue.maxConcurrentActivities);
      if (running.length >= queue.maxConcurrentActivities) return null;
    }

    const now = Date.now();
    const candidates = await Promise.all(
      args.supportedActivities.map(
        async ({ name, version }) =>
          await ctx.db
            .query("activities")
            .withIndex("by_queue_state_activity_available", (q) =>
              q
                .eq("taskQueue", args.taskQueue)
                .eq("state", "scheduled")
                .eq("activityType", name)
                .eq("activityVersion", version)
                .lte("nextAttemptAt", now),
            )
            .first(),
      ),
    );
    const activity = candidates
      .filter((candidate): candidate is Activity => candidate !== null)
      .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt)[0];
    if (!activity) return null;

    if (activity.cancelRequested) {
      await finish(ctx, activity, { kind: "canceled" });
      return null;
    }
    if (now >= activity.scheduleDeadline) {
      await finish(ctx, activity, {
        kind: "failed",
        errorType: "ScheduleToCloseTimeout",
        errorMessage: "Activity exceeded its schedule-to-close timeout",
      });
      return null;
    }

    const attempt = activity.attempt + 1;
    const leaseToken = crypto.randomUUID();
    const attemptDeadline = Math.min(
      now + activity.startToCloseTimeoutMs,
      activity.scheduleDeadline,
    );
    const leaseExpiresAt = Math.min(now + queue.leaseDurationMs, attemptDeadline);
    await ctx.db.insert("attempts", { token: leaseToken, activityId: activity._id, attempt });
    await ctx.db.patch(activity._id, {
      state: "running",
      attempt,
      startedAt: activity.startedAt ?? now,
      workerId: args.workerId,
      leaseToken,
      leaseExpiresAt,
      attemptDeadline,
      updatedAt: now,
      progress: undefined,
      progressMessage: undefined,
      heartbeatDetails: undefined,
    });
    await ctx.scheduler.runAt(leaseExpiresAt, internal.activities.watchdog, {
      activityId: activity._id,
    });
    return claimedActivity(
      { ...activity, attempt },
      {
        leaseToken,
        leaseExpiresAt,
        attemptDeadline,
      },
    );
  },
});

function claimedActivity(
  activity: Activity,
  lease: {
    leaseToken: string;
    leaseExpiresAt: number;
    attemptDeadline: number;
  },
) {
  return {
    protocolVersion: activity.protocolVersion,
    activityId: activity._id,
    activityType: activity.activityType,
    activityVersion: activity.activityVersion,
    taskQueue: activity.taskQueue,
    attempt: activity.attempt,
    attemptToken: lease.leaseToken,
    leaseExpiresAt: lease.leaseExpiresAt,
    attemptDeadline: lease.attemptDeadline,
    scheduleDeadline: activity.scheduleDeadline,
    input: activity.input,
    artifactSlots: activity.artifactSlots ?? [],
  };
}

export const renew = mutation({
  args: {
    attemptToken: v.string(),
    progress: v.optional(v.number()),
    progressMessage: v.optional(v.string()),
    heartbeatDetails: v.optional(v.any()),
  },
  returns: v.object({
    accepted: v.boolean(),
    cancelRequested: v.boolean(),
    leaseExpiresAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const activity = await currentLease(ctx, args.attemptToken);
    if (!activity) return { accepted: false, cancelRequested: true };
    const queue = await ctx.db
      .query("queues")
      .withIndex("by_name", (q) => q.eq("name", activity.taskQueue))
      .unique();
    if (!queue) throw new Error("Activity queue not found");
    const now = Date.now();
    const leaseExpiresAt = Math.min(
      now + queue.leaseDurationMs,
      activity.attemptDeadline ?? now,
      activity.scheduleDeadline,
    );
    await ctx.db.patch(activity._id, {
      leaseExpiresAt,
      progress:
        args.progress === undefined ? activity.progress : Math.min(1, Math.max(0, args.progress)),
      progressMessage:
        args.progressMessage === undefined
          ? activity.progressMessage
          : args.progressMessage.slice(0, 2_000),
      heartbeatDetails:
        args.heartbeatDetails === undefined ? activity.heartbeatDetails : args.heartbeatDetails,
      updatedAt: now,
    });
    return {
      accepted: true,
      cancelRequested: !!activity.cancelRequested,
      leaseExpiresAt,
    };
  },
});

// A receipt belongs to an attempt, not an HTTP request. Lost responses and retries
// return the same decision even after the next attempt has started.
async function commitAttempt(
  ctx: MutationCtx,
  token: string,
  request: Value,
  commit: (activity: Activity) => Promise<boolean>,
) {
  const attempt = await attemptForToken(ctx, token);
  if (attempt?.receipt) {
    if (compareValues(attempt.receipt.request, request) !== 0)
      throw new Error("Attempt already settled with a different result");
    return { accepted: true, duplicate: true, retrying: attempt.receipt.retrying };
  }
  const activity = await currentLease(ctx, token);
  if (!activity || !attempt) return { accepted: false, duplicate: false, retrying: false };
  if (activity.cancelRequested) {
    await finish(ctx, activity, { kind: "canceled" });
    return { accepted: false, duplicate: false, retrying: false };
  }
  const retrying = await commit(activity);
  await ctx.db.patch(attempt._id, { receipt: { request, retrying } });
  return { accepted: true, duplicate: false, retrying };
}

export const complete = mutation({
  args: { attemptToken: v.string(), value: v.any() },
  returns: v.object({ accepted: v.boolean(), duplicate: v.boolean(), retrying: v.boolean() }),
  handler: async (ctx, args) =>
    await commitAttempt(
      ctx,
      args.attemptToken,
      { kind: "success", value: args.value },
      async (activity) => {
        if (!("outputSchema" in activity)) throw new Error("Legacy activity cannot complete");
        parseWire(activity.outputSchema as WireSchema, args.value);
        for (const slot of activity.artifactSlots ?? []) {
          const artifactId = ctx.db.normalizeId("artifacts", args.value[slot]);
          const artifact = artifactId ? await ctx.db.get(artifactId) : null;
          if (
            !artifact ||
            artifact.activityId !== activity._id ||
            artifact.attempt !== activity.attempt ||
            artifact.slot !== slot ||
            artifact.scopeId !== activity.artifactScopeId ||
            artifact.state !== "staged"
          ) {
            throw new Error(`Invalid output artifact for slot ${slot}`);
          }
          if (!(await ctx.db.system.get("_storage", artifact.storageId)))
            throw new Error("Output storage is missing");
        }
        await finish(ctx, activity, { kind: "success", value: args.value });
        return false;
      },
    ),
});

export const fail = mutation({
  args: {
    attemptToken: v.string(),
    errorType: v.string(),
    errorMessage: v.string(),
    nonRetryable: v.optional(v.boolean()),
  },
  returns: v.object({ accepted: v.boolean(), duplicate: v.boolean(), retrying: v.boolean() }),
  handler: async (ctx, args) =>
    await commitAttempt(
      ctx,
      args.attemptToken,
      {
        kind: "failed",
        errorType: args.errorType,
        errorMessage: args.errorMessage,
        nonRetryable: args.nonRetryable ?? false,
      },
      async (activity) => await retryOrFinish(ctx, activity, args),
    ),
});

export const requestCancel = mutation({
  args: { activityId: v.id("activities") },
  returns: v.null(),
  handler: async (ctx, { activityId }) => {
    const activity = await ctx.db.get(activityId);
    if (!activity || isTerminal(activity)) return null;
    if (activity.state === "scheduled") {
      await finish(ctx, activity, { kind: "canceled" });
    } else {
      await ctx.db.patch(activityId, { cancelRequested: true, updatedAt: Date.now() });
    }
    return null;
  },
});

export const acknowledgeCancellation = mutation({
  args: { attemptToken: v.string() },
  returns: v.object({ accepted: v.boolean(), duplicate: v.boolean() }),
  handler: async (ctx, { attemptToken }) => {
    const attempt = await attemptForToken(ctx, attemptToken);
    const activity = attempt ? await ctx.db.get(attempt.activityId) : null;
    if (activity?.state === "canceled") return { accepted: true, duplicate: true };
    const leased = await currentLease(ctx, attemptToken);
    if (!leased?.cancelRequested) return { accepted: false, duplicate: false };
    await finish(ctx, leased, { kind: "canceled" });
    return { accepted: true, duplicate: false };
  },
});

export const watchdog = internalMutation({
  args: { activityId: v.id("activities") },
  returns: v.null(),
  handler: async (ctx, { activityId }) => {
    const activity = await ctx.db.get(activityId);
    if (!activity || isTerminal(activity)) return null;
    const now = Date.now();
    if (now >= activity.scheduleDeadline) {
      await finish(ctx, activity, {
        kind: "failed",
        errorType: "ScheduleToCloseTimeout",
        errorMessage: "Activity exceeded its schedule-to-close timeout",
      });
      return null;
    }
    if (activity.state === "scheduled") {
      await ctx.scheduler.runAt(activity.scheduleDeadline, internal.activities.watchdog, {
        activityId,
      });
      return null;
    }
    if (activity.cancelRequested && now >= (activity.leaseExpiresAt ?? now)) {
      await finish(ctx, activity, { kind: "canceled" });
      return null;
    }
    if (now >= (activity.attemptDeadline ?? now)) {
      await retryOrFinish(ctx, activity, {
        errorType: "StartToCloseTimeout",
        errorMessage: "Activity attempt exceeded its start-to-close timeout",
      });
      return null;
    }
    if (now >= (activity.leaseExpiresAt ?? now)) {
      await retryOrFinish(ctx, activity, {
        errorType: "WorkerLost",
        errorMessage: "Activity worker lease expired",
      });
      return null;
    }
    await ctx.scheduler.runAt(
      Math.min(
        activity.leaseExpiresAt ?? now,
        activity.attemptDeadline ?? now,
        activity.scheduleDeadline,
      ),
      internal.activities.watchdog,
      { activityId },
    );
    return null;
  },
});

function isTerminal(activity: Activity) {
  return (
    activity.state === "completed" || activity.state === "failed" || activity.state === "canceled"
  );
}

function retryDelay(activity: Activity) {
  return Math.min(
    activity.retryPolicy.maximumIntervalMs,
    activity.retryPolicy.initialIntervalMs *
      activity.retryPolicy.backoffCoefficient ** Math.max(0, activity.attempt - 1),
  );
}

async function retryOrFinish(
  ctx: MutationCtx,
  activity: Activity,
  error: {
    errorType: string;
    errorMessage: string;
    nonRetryable?: boolean;
  },
) {
  const now = Date.now();
  const delay = retryDelay(activity);
  const retryable =
    !error.nonRetryable &&
    !activity.retryPolicy.nonRetryableErrorTypes.includes(error.errorType) &&
    activity.attempt < activity.retryPolicy.maximumAttempts &&
    now + delay < activity.scheduleDeadline;
  if (!retryable) {
    await finish(ctx, activity, {
      kind: "failed",
      errorType: error.errorType,
      errorMessage: error.errorMessage.slice(0, 2_000),
    });
    return false;
  }
  await ctx.db.patch(activity._id, {
    state: "scheduled",
    nextAttemptAt: now + delay,
    workerId: undefined,
    leaseToken: undefined,
    leaseExpiresAt: undefined,
    attemptDeadline: undefined,
    progress: undefined,
    progressMessage: undefined,
    heartbeatDetails: undefined,
    lastErrorType: error.errorType,
    lastErrorMessage: error.errorMessage.slice(0, 2_000),
    updatedAt: now,
  });
  return true;
}

async function finish(ctx: MutationCtx, activity: Activity, result: TerminalResult) {
  const now = Date.now();
  const terminal =
    result.kind === "success"
      ? { state: "completed" as const, result }
      : result.kind === "canceled"
        ? { state: "canceled" as const, result }
        : { state: "failed" as const, result };
  await ctx.db.patch(activity._id, {
    ...terminal,
    workerId: undefined,
    leaseToken: undefined,
    leaseExpiresAt: undefined,
    attemptDeadline: undefined,
    completedAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(TERMINAL_RETENTION_MS, internal.activities.deleteTerminal, {
    activityId: activity._id,
  });
  if (!activity.completion) return;
  await deliver(ctx, activity._id, activity.completion, result, 0);
}

async function deliver(
  ctx: MutationCtx,
  activityId: Id<"activities">,
  completionConfig: NonNullable<Activity["completion"]>,
  result: TerminalResult,
  previousAttempts: number,
) {
  try {
    await ctx.runMutation(completionConfig.fnHandle as FunctionHandle<"mutation">, {
      activityId: activityId as string,
      context: completionConfig.context,
      result,
    });
    await ctx.db.patch(activityId, {
      deliveryState: "delivered",
      deliveryAttempts: previousAttempts + 1,
      deliveryError: undefined,
    });
  } catch (error) {
    const attempts = previousAttempts + 1;
    const delay = Math.min(DELIVERY_RETRY_MAX_MS, 1_000 * 2 ** Math.min(attempts - 1, 8));
    await ctx.db.patch(activityId, {
      deliveryState: "pending",
      deliveryAttempts: attempts,
      deliveryError:
        error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
    });
    await ctx.scheduler.runAfter(delay, internal.activities.deliverCompletion, { activityId });
  }
}

export const deliverCompletion = internalMutation({
  args: { activityId: v.id("activities") },
  returns: v.null(),
  handler: async (ctx, { activityId }) => {
    const activity = await ctx.db.get(activityId);
    if (
      !activity ||
      !activity.completion ||
      !activity.result ||
      activity.deliveryState === "delivered"
    ) {
      return null;
    }
    await deliver(
      ctx,
      activityId,
      activity.completion,
      activity.result,
      activity.deliveryAttempts ?? 0,
    );
    return null;
  },
});

export const deleteTerminal = internalMutation({
  args: { activityId: v.id("activities") },
  returns: v.null(),
  handler: async (ctx, { activityId }) => {
    const activity = await ctx.db.get(activityId);
    if (!activity || !isTerminal(activity)) return null;
    const eligibleAt = (activity.completedAt ?? activity.updatedAt) + TERMINAL_RETENTION_MS;
    if (eligibleAt > Date.now()) {
      await ctx.scheduler.runAt(eligibleAt, internal.activities.deleteTerminal, {
        activityId,
      });
      return null;
    }
    if (activity.completion && activity.deliveryState !== "delivered") {
      await ctx.scheduler.runAfter(24 * 60 * 60_000, internal.activities.deleteTerminal, {
        activityId,
      });
      return null;
    }
    for (const attempt of await ctx.db
      .query("attempts")
      .withIndex("by_activity", (q) => q.eq("activityId", activityId))
      .collect())
      await ctx.db.delete(attempt._id);
    await ctx.db.delete(activityId);
    return null;
  },
});

export const get = query({
  args: { activityId: v.id("activities") },
  returns: v.union(
    v.null(),
    v.object({
      activityId: v.id("activities"),
      protocolVersion: v.number(),
      activityType: v.string(),
      activityVersion: v.number(),
      taskQueue: v.string(),
      state: v.union(
        v.literal("scheduled"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("canceled"),
      ),
      attempt: v.number(),
      nextAttemptAt: v.number(),
      scheduleDeadline: v.number(),
      leaseExpiresAt: v.optional(v.number()),
      attemptDeadline: v.optional(v.number()),
      cancelRequested: v.boolean(),
      progress: v.optional(v.number()),
      progressMessage: v.optional(v.string()),
      result: v.optional(completionResult),
      lastErrorType: v.optional(v.string()),
      lastErrorMessage: v.optional(v.string()),
      deliveryState: v.optional(v.union(v.literal("pending"), v.literal("delivered"))),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { activityId }) => {
    const activity = await ctx.db.get(activityId);
    if (!activity) return null;
    return {
      activityId: activity._id,
      protocolVersion: activity.protocolVersion,
      activityType: activity.activityType,
      activityVersion: activity.activityVersion,
      taskQueue: activity.taskQueue,
      state: activity.state,
      attempt: activity.attempt,
      nextAttemptAt: activity.nextAttemptAt,
      scheduleDeadline: activity.scheduleDeadline,
      leaseExpiresAt: activity.leaseExpiresAt ?? undefined,
      attemptDeadline: activity.attemptDeadline ?? undefined,
      cancelRequested: !!activity.cancelRequested,
      progress: activity.progress,
      progressMessage: activity.progressMessage,
      result: activity.result ?? undefined,
      lastErrorType: activity.lastErrorType,
      lastErrorMessage: activity.lastErrorMessage,
      deliveryState: activity.deliveryState,
      createdAt: activity.createdAt,
      startedAt: activity.startedAt,
      completedAt: activity.completedAt,
    };
  },
});

// Keep a public reference in the generated API even when only internal helpers use it.
void api;

export const cancelScope = mutation({
  args: { scopeId: v.id("artifactScopes") },
  returns: v.null(),
  handler: async (ctx, { scopeId }) => {
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_scope", (q) => q.eq("artifactScopeId", scopeId))
      .collect();
    for (const activity of activities)
      if (!isTerminal(activity)) await finish(ctx, activity, { kind: "canceled" });
    return null;
  },
});

// Application resource reads can use the same capability as worker writes.
export const getAttemptInput = query({
  args: { attemptToken: v.string() },
  returns: v.object({ activityType: v.string(), workflowId: v.string(), input: v.any() }),
  handler: async (ctx, { attemptToken }) => {
    const activity = await currentLease(ctx, attemptToken);
    if (!activity || activity.cancelRequested) throw new Error("Activity lease is not current");
    if (!activity.artifactScopeId) throw new Error("Legacy activity has no artifact scope");
    const scope = await ctx.db.get(activity.artifactScopeId);
    if (!scope?.workflowId || scope.state !== "open" || scope.expiresAt <= Date.now())
      throw new Error("Artifact scope is not open");
    return {
      activityType: activity.activityType,
      workflowId: scope.workflowId,
      input: activity.input,
    };
  },
});
