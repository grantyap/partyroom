import type { OnlineTimingObject } from "$lib/online-timing-object.svelte";
import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
import { createContext } from "svelte";
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
  playerShell = $state<HTMLElement>();
  #tvMode = $state(false);

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

  get tvMode() {
    return this.#tvMode;
  }

  handleFullscreenChange = () => {
    this.#tvMode = document.fullscreenElement === this.playerShell;
  };

  toggleTvMode = async () => {
    if (!this.playerShell) return;
    if (document.fullscreenElement === this.playerShell) {
      await document.exitFullscreen();
    } else {
      await this.playerShell.requestFullscreen();
    }
  };
}

const [getPlaybackContext, providePlaybackContext] = createContext<PlaybackContext>();

export function setPlaybackContext(props: PlaybackContextProps) {
  return providePlaybackContext(new PlaybackContext(props));
}

export function usePlayback() {
  return getPlaybackContext();
}
