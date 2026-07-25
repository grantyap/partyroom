import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { roomRoleSchema } from "./rooms.schema";
import { mediaTables } from "./media/schema";

export default defineSchema({
  ...mediaTables,
  rooms: defineTable({
    owner: v.string(),
    name: v.string(),
  })
    .index("by_owner", ["owner"])
    .index("by_name", ["name"]),
  roomMembers: defineTable({
    room: v.id("rooms"),
    user: v.string(),
    role: roomRoleSchema,
  })
    .index("by_room", ["room"])
    .index("by_user", ["user"])
    .index("by_room_user", ["room", "user"]),
  messages: defineTable({
    room: v.id("rooms"),
    user: v.string(),
    body: v.string(),
  })
    .index("by_room", ["room"])
    .index("by_room_user", ["room", "user"]),
});
