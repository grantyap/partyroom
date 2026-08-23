import { api } from "@partyroom/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type ChatMessage = FunctionReturnType<(typeof api.chat)["getMessages"]>[number];

export type Playback = NonNullable<FunctionReturnType<(typeof api.playback)["get"]>>;

export type RoomMediaItem = FunctionReturnType<(typeof api.media.jobs)["listRoomMedia"]>[number];

export type MediaStep = RoomMediaItem["steps"][number];

export type OverlayMessage = {
  id: string;
  body: string;
  color: string;
};
