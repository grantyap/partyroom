import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { roomMemberPermissionsSchema } from "./rooms.schema";
import { mediaTables } from "./media/schema";

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
  })
    .index("by_room", ["room"])
    .index("by_room_user", ["room", "user"]),
  roomPlayback: defineTable({
    room: v.id("rooms"),
    currentQueueItem: v.optional(v.id("roomQueueItems")),
    status: v.union(v.literal("idle"), v.literal("playing"), v.literal("paused")),
    anchorPositionMs: v.number(),
    anchorUpdatedAt: v.number(),
    revision: v.number(),
    queueRevision: v.number(),
    occupancyGeneration: v.number(),
    emptySince: v.optional(v.number()),
    presenceCheckAt: v.optional(v.number()),
  }).index("by_room", ["room"]),
  roomQueueItems: defineTable({
    room: v.id("rooms"),
    roomMedia: v.id("roomMedia"),
    rank: v.string(),
    addedBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_room_and_rank", ["room", "rank"])
    .index("by_room_media", ["room", "roomMedia"]),
});
