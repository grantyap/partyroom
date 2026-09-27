import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { roomMemberPermissionsSchema } from "./rooms.schema";
import { mediaTables } from "./media/schema";
import { roomPlaybackState } from "./playback.schema";

export default defineSchema({
  ...mediaTables,
  rooms: defineTable({
    owner: v.string(),
    name: v.string(),
    memberPermissions: roomMemberPermissionsSchema,
  })
    .index("by_owner", ["owner"])
    .index("by_name", ["name"]),
  roomVisits: defineTable({
    room: v.id("rooms"),
    user: v.string(),
    lastVisitedAt: v.number(),
  })
    .index("by_room", ["room"])
    .index("by_room_and_user", ["room", "user"])
    .index("by_user_and_last_visited_at", ["user", "lastVisitedAt"]),
  messages: defineTable({
    room: v.id("rooms"),
    user: v.string(),
    body: v.string(),
    clientMessageId: v.string(),
  })
    .index("by_room", ["room"])
    .index("by_room_user", ["room", "user"])
    .index("by_user", ["user"])
    .index("by_room_and_client_message_id", ["room", "clientMessageId"]),
  roomPlayback: defineTable({
    room: v.id("rooms"),
    state: roomPlaybackState,
    revision: v.number(),
    queueRevision: v.number(),
  }).index("by_room", ["room"]),
  migrationRuns: defineTable({
    migrationId: v.string(),
    phase: v.union(
      v.literal("preflight"),
      v.literal("apply"),
      v.literal("verify"),
      v.literal("finalize"),
      v.literal("complete"),
    ),
    activityCursor: v.optional(v.string()),
    workflowStepCursor: v.optional(v.string()),
    routingVersion: v.optional(v.union(v.literal(1), v.literal(2))),
    updatedAt: v.number(),
  }).index("by_migration_id", ["migrationId"]),
  // TODO(deprecation): Remove manual-runner verification records in a later
  // migration once no older deployment needs their history.
  migrationVerifications: defineTable({
    migrationId: v.string(),
    generation: v.string(),
    completedAt: v.number(),
    clean: v.boolean(),
    invariantCounts: v.object({
      blockers: v.number(),
      legacy: v.number(),
      activeV1Workflows: v.number(),
      activeV1Activities: v.number(),
      pendingAdoptions: v.number(),
    }),
    dataWatermark: v.string(),
  })
    .index("by_migration_id", ["migrationId"])
    .index("by_generation", ["generation"]),
});
