import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  artifactDefinition,
  artifactDisposition,
  completion,
  completionResult,
  retryPolicy,
} from "./validators";

const activityFields = {
  protocolVersion: v.number(),
  activityType: v.string(),
  activityVersion: v.number(),
  taskQueue: v.string(),
  input: v.any(),
  outputSchema: v.any(),
  artifactScopeId: v.id("artifactScopes"),
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
  deliveryState: v.optional(v.union(v.literal("pending"), v.literal("delivered"))),
  deliveryAttempts: v.optional(v.number()),
  deliveryError: v.optional(v.string()),
  lastErrorType: v.optional(v.string()),
  lastErrorMessage: v.optional(v.string()),
  createdAt: v.number(),
  startedAt: v.optional(v.number()),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
};

const unleased = {
  workerId: v.optional(v.null()),
  leaseToken: v.optional(v.null()),
  leaseExpiresAt: v.optional(v.null()),
  attemptDeadline: v.optional(v.null()),
};

const artifactFields = {
  scopeId: v.id("artifactScopes"),
  activityId: v.id("activities"),
  attempt: v.number(),
  slot: v.string(),
  disposition: artifactDisposition,
  storageId: v.id("_storage"),
  createdAt: v.number(),
  updatedAt: v.number(),
};

const legacyActivity = v.object({
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
  startedAt: v.optional(v.number()),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

const legacyWorkflowStep = v.object({
  workflowId: v.string(),
  key: v.string(),
  label: v.string(),
  position: v.number(),
  kind: v.union(v.literal("activity"), v.literal("workflow")),
  state: v.union(
    v.literal("pending"),
    v.literal("queued"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("canceled"),
    v.literal("skipped"),
  ),
  activityId: v.optional(v.id("activities")),
  message: v.optional(v.string()),
  error: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const legacyArtifact = v.object({
  ...artifactFields,
  state: v.union(v.literal("staged"), v.literal("adopted")),
});

export default defineSchema({
  queues: defineTable({
    name: v.string(),
    leaseDurationMs: v.number(),
    maxConcurrentActivities: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

  activities: defineTable(
    v.union(
      v.object({
        ...activityFields,
        ...unleased,
        state: v.literal("scheduled"),
        result: v.optional(v.null()),
      }),
      v.object({
        ...activityFields,
        ...unleased,
        state: v.literal("running"),
        workerId: v.string(),
        leaseToken: v.string(),
        leaseExpiresAt: v.number(),
        attemptDeadline: v.number(),
        startedAt: v.number(),
        result: v.optional(v.null()),
      }),
      v.object({
        ...activityFields,
        ...unleased,
        state: v.literal("completed"),
        completedAt: v.number(),
        result: v.object({ kind: v.literal("success"), value: v.any() }),
      }),
      v.object({
        ...activityFields,
        ...unleased,
        state: v.literal("failed"),
        completedAt: v.number(),
        result: v.object({
          kind: v.literal("failed"),
          errorType: v.string(),
          errorMessage: v.string(),
        }),
      }),
      v.object({
        ...activityFields,
        ...unleased,
        state: v.literal("canceled"),
        completedAt: v.number(),
        result: v.object({ kind: v.literal("canceled") }),
      }),
      legacyActivity,
    ),
  )
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
    .index("by_state", ["state"])
    .index("by_scope", ["artifactScopeId"]),

  attempts: defineTable({
    token: v.string(),
    activityId: v.id("activities"),
    attempt: v.number(),
    receipt: v.optional(
      v.object({
        request: v.any(),
        retrying: v.boolean(),
      }),
    ),
  })
    .index("by_token", ["token"])
    .index("by_activity", ["activityId"]),

  workflowSteps: defineTable(
    v.union(
      v.object({
        workflowId: v.string(),
        key: v.string(),
        label: v.string(),
        position: v.number(),
        kind: v.union(v.literal("activity"), v.literal("workflow")),
      }),
      legacyWorkflowStep,
    ),
  ).index("by_workflow_id", ["workflowId"]),

  artifactScopes: defineTable({
    state: v.union(v.literal("open"), v.literal("closed"), v.literal("abandoned")),
    workflowId: v.optional(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workflow_id", ["workflowId"])
    .index("by_state_and_expires_at", ["state", "expiresAt"]),

  artifacts: defineTable(
    v.union(
      v.object({ ...artifactFields, state: v.literal("staged"), owner: v.optional(v.null()) }),
      v.object({ ...artifactFields, state: v.literal("adopted"), owner: v.string() }),
      legacyArtifact,
    ),
  )
    .index("by_scope_and_state", ["scopeId", "state"])
    .index("by_activity_and_attempt", ["activityId", "attempt"])
    .index("by_activity_attempt_and_slot", ["activityId", "attempt", "slot"])
    .index("by_storage_id", ["storageId"]),

  artifactGcState: defineTable({
    name: v.string(),
    cursor: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),
});
