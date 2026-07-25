import { protocolVersion } from "@partyroom/activities";
import { z } from "zod";

export const activityDefinitionSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
});

export const claimRequestSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  taskQueue: z.string().min(1),
  workerId: z.string().min(1),
  supportedActivities: z.array(activityDefinitionSchema).min(1),
});

export const claimedActivitySchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  activityId: z.string().min(1),
  activityType: z.string().min(1),
  activityVersion: z.number().int().positive(),
  taskQueue: z.string().min(1),
  attempt: z.number().int().positive(),
  leaseToken: z.string().min(1),
  leaseExpiresAt: z.number(),
  attemptDeadline: z.number(),
  scheduleDeadline: z.number(),
  input: z.unknown(),
  artifactScopeId: z.string().optional(),
  artifactSlots: z.array(z.string()),
});

export const claimResponseSchema = z.union([z.null(), claimedActivitySchema]);

export const renewalResponseSchema = z.object({
  accepted: z.boolean(),
  cancelRequested: z.boolean(),
  leaseExpiresAt: z.number().optional(),
});

const leasedRequestSchema = z.object({
  activityId: z.string().min(1),
  attempt: z.number().int().positive(),
  leaseToken: z.string().min(1),
});

export const renewRequestSchema = leasedRequestSchema.extend({
  progress: z.number().optional(),
  progressMessage: z.string().optional(),
  heartbeatDetails: z.unknown().optional(),
});

export const completeRequestSchema = leasedRequestSchema.extend({
  requestId: z.string().min(1),
  value: z.unknown(),
});

export const failRequestSchema = leasedRequestSchema.extend({
  requestId: z.string().min(1),
  errorType: z.string().min(1),
  errorMessage: z.string(),
  nonRetryable: z.boolean().optional(),
});

export const cancelRequestSchema = leasedRequestSchema.extend({
  requestId: z.string().min(1),
});

export const artifactUploadRequestSchema = leasedRequestSchema.extend({
  slot: z.string().min(1),
});

export const artifactRegisterRequestSchema = artifactUploadRequestSchema.extend({
  storageId: z.string().min(1),
});

export const artifactUploadResponseSchema = z.object({
  uploadUrl: z.string().url(),
});

export const artifactRegisterResponseSchema = z.object({
  artifactId: z.string().min(1),
});

export const terminalResponseSchema = z.object({
  accepted: z.boolean(),
  duplicate: z.boolean(),
});

export const failureResponseSchema = terminalResponseSchema.extend({
  retrying: z.boolean(),
});

export type ClaimedActivity = z.infer<typeof claimedActivitySchema>;
