import { v } from "convex/values";

export { protocolVersion } from "../protocol";

export const activityState = v.union(
  v.literal("scheduled"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const retryPolicy = v.object({
  maximumAttempts: v.number(),
  initialIntervalMs: v.number(),
  backoffCoefficient: v.number(),
  maximumIntervalMs: v.number(),
  nonRetryableErrorTypes: v.array(v.string()),
});

export const activityDefinition = v.object({
  name: v.string(),
  version: v.number(),
});

export const completionResult = v.union(
  v.object({ kind: v.literal("success"), value: v.any() }),
  v.object({
    kind: v.literal("failed"),
    errorType: v.string(),
    errorMessage: v.string(),
  }),
  v.object({ kind: v.literal("canceled") }),
);

export const completion = v.object({
  fnHandle: v.string(),
  context: v.optional(v.any()),
});

export const artifactSlot = v.string();
export const artifactDisposition = v.union(v.literal("intermediate"), v.literal("retained"));
export const artifactDefinition = v.object({
  slot: artifactSlot,
  disposition: artifactDisposition,
});
