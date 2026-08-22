import { v } from "convex/values";

export const roomMemberPermissionsSchema = v.object({
  controlPlayback: v.boolean(),
  addToQueue: v.boolean(),
  reorderQueue: v.boolean(),
  removeFromQueue: v.boolean(),
  sendChat: v.boolean(),
});

export const defaultRoomMemberPermissions = {
  controlPlayback: false,
  addToQueue: true,
  reorderQueue: false,
  removeFromQueue: false,
  sendChat: true,
} as const;
