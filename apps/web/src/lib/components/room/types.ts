import { api } from "@partyroom/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type ChatMessage = FunctionReturnType<(typeof api.chat)["getMessages"]>[number];

export type Playback = NonNullable<FunctionReturnType<(typeof api.playback)["get"]>>;

export type Room = FunctionReturnType<(typeof api.rooms)["getRoomByName"]>;

export type RoomMemberPermissions = Room["memberPermissions"];

export type RoomMemberPermission = keyof RoomMemberPermissions;

export type RoomMediaItem = FunctionReturnType<(typeof api.media.jobs)["listRoomMedia"]>[number];

export type CurrentMedia = {
  _id: RoomMediaItem["_id"];
  title?: string | null;
  duration?: number;
  finalUrl?: string | null;
  lyrics: RoomMediaItem["lyrics"];
  selectedLyricsId?: string;
  lyricsOffsetMs: number;
};

export type MediaStep = RoomMediaItem["steps"][number];

export type OverlayMessage = {
  id: string;
  body: string;
  color: string;
};
