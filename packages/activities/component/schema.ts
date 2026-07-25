import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  activityState,
  artifactDefinition,
  artifactDisposition,
  completion,
  completionResult,
  retryPolicy,
} from "./validators";

export default defineSchema({
  queues: defineTable({
    name: v.string(),
    leaseDurationMs: v.number(),
    maxConcurrentActivities: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

  activities: defineTable({
    protocolVersion: v.number(),
    activityType: v.string(),
    activityVersion: v.number(),
    taskQueue: v.string(),
    state: activityState,
    input: v.any(),
    artifactScopeId: v.optional(v.id("artifactScopes")),
    artifactSlots: v.optional(v.array(v.string())),
    artifactDefinitions: v.optional(v.array(artifactDefinition)),
    completion: v.optional(completion),
    retryPolicy,
    startToCloseTimeoutMs: v.number(),
    scheduleToCloseTimeoutMs: v.number(),
    scheduleDeadline: v.number(),
    nextAttemptAt: v.number(),
    attempt: v.number(),
    workerId: v.optional(v.string()),
    leaseToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    attemptDeadline: v.optional(v.number()),
    cancelRequested: v.optional(v.boolean()),
    progress: v.optional(v.number()),
    progressMessage: v.optional(v.string()),
    heartbeatDetails: v.optional(v.any()),
    result: v.optional(completionResult),
    terminalRequestId: v.optional(v.string()),
    lastRequestId: v.optional(v.string()),
    lastRequestAttempt: v.optional(v.number()),
    deliveryState: v.optional(v.union(v.literal("pending"), v.literal("delivered"))),
    deliveryAttempts: v.optional(v.number()),
    deliveryError: v.optional(v.string()),
    lastErrorType: v.optional(v.string()),
    lastErrorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_queue_state_available", ["taskQueue", "state", "nextAttemptAt"])
    .index("by_queue_state_activity_available", [
      "taskQueue",
      "state",
      "activityType",
      "activityVersion",
      "nextAttemptAt",
    ])
    .index("by_queue_state", ["taskQueue", "state"])
    .index("by_worker_state", ["workerId", "state"])
    .index("by_state", ["state"]),

  artifactScopes: defineTable({
    state: v.union(v.literal("open"), v.literal("closed"), v.literal("abandoned")),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_state_and_expires_at", ["state", "expiresAt"]),

  artifacts: defineTable({
    scopeId: v.id("artifactScopes"),
    activityId: v.id("activities"),
    attempt: v.number(),
    slot: v.string(),
    disposition: artifactDisposition,
    storageId: v.id("_storage"),
    state: v.union(v.literal("staged"), v.literal("adopted")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_scope_and_state", ["scopeId", "state"])
    .index("by_activity_and_attempt", ["activityId", "attempt"])
    .index("by_storage_id", ["storageId"]),

  artifactGcState: defineTable({
    name: v.string(),
    cursor: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),
});
