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
});
