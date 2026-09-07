import type { CapabilityValues } from "./types";

const roomKey = "room";

export const rooms = {
  list: `${roomKey}:list`,
  read: `${roomKey}:read`,
  create: `${roomKey}:create`,
  update: `${roomKey}:update`,
  chat: `${roomKey}:chat`,
  controlPlayback: `${roomKey}:controlPlayback`,
  addToQueue: `${roomKey}:addToQueue`,
  reorderQueue: `${roomKey}:reorderQueue`,
  removeFromQueue: `${roomKey}:removeFromQueue`,
} as const;

export type RoomCapability = CapabilityValues<typeof rooms>;
export type RoomPermission = Exclude<RoomCapability, typeof rooms.list | typeof rooms.create>;
