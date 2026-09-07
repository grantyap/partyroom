import { v, type Infer } from "convex/values";

export const roomMemberPermissionsSchema = v.object({
  controlPlayback: v.boolean(),
  addToQueue: v.boolean(),
  reorderQueue: v.boolean(),
  removeFromQueue: v.boolean(),
  sendChat: v.boolean(),
});

type RoomMemberPermissions = Infer<typeof roomMemberPermissionsSchema>;

export const defaultRoomMemberPermissions = {
  controlPlayback: false,
  addToQueue: true,
  reorderQueue: false,
  removeFromQueue: false,
  sendChat: true,
} satisfies RoomMemberPermissions;
