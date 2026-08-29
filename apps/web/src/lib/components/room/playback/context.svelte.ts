import type { OnlineTimingObject } from "$lib/online-timing-object.svelte";
import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
import { getContext, setContext } from "svelte";
import type { CurrentMedia, OverlayMessage, Playback, RoomMediaItem } from "../types";

type PlaybackContextProps = {
  roomId: () => Id<"rooms">;
  playback: () => Playback | undefined;
  mediaById: () => Map<Id<"roomMedia">, RoomMediaItem>;
  currentMedia: () => CurrentMedia | undefined;
  overlayMessages: () => OverlayMessage[];
  error: () => string | null;
  timing: OnlineTimingObject;
};

class PlaybackContext {
  constructor(private readonly props: PlaybackContextProps) {}

  get roomId() {
    return this.props.roomId();
  }

  get playback() {
    return this.props.playback();
  }

  get mediaById() {
    return this.props.mediaById();
  }

  get currentMedia() {
    return this.props.currentMedia();
  }

  get overlayMessages() {
    return this.props.overlayMessages();
  }

  get error() {
    return this.props.error();
  }

  get timing() {
    return this.props.timing;
  }
}

const PLAYBACK_CONTEXT = Symbol("room-playback");

export function setPlaybackContext(props: PlaybackContextProps) {
  return setContext(PLAYBACK_CONTEXT, new PlaybackContext(props));
}

export function usePlayback() {
  const context = getContext<PlaybackContext>(PLAYBACK_CONTEXT);
  if (!context) {
    throw new Error("Playback components must be rendered inside Playback.Root");
  }
  return context;
}
