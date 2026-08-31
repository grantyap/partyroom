import type { OnlineTimingObject } from "$lib/online-timing-object.svelte";
import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
import { createContext } from "svelte";
import type { CurrentMedia, OverlayMessage, Playback, RoomMediaItem } from "../types";
import { KaraokeLyricsState } from "./karaoke-lyrics-state.svelte";

type PlaybackContextProps = {
  roomId: () => Id<"rooms">;
  playback: () => Playback | undefined;
  mediaById: () => Map<Id<"roomMedia">, RoomMediaItem>;
  currentMedia: () => CurrentMedia | undefined;
  overlayMessages: () => OverlayMessage[] | undefined;
  error: () => string | null;
  timing: OnlineTimingObject;
};

class PlaybackContext {
  playerShell = $state<HTMLElement>();
  #tvMode = $state(false);
  #currentTime = $state(0);
  #animationFrame: number | undefined;
  #lyrics: KaraokeLyricsState;

  constructor(private readonly props: PlaybackContextProps) {
    this.#lyrics = new KaraokeLyricsState({
      getLyrics: () => this.currentMedia?.lyrics ?? [],
      getSelectedLyricsId: () => this.currentMedia?.selectedLyricsId,
      getLyricsOffsetMs: () => this.currentMedia?.lyricsOffsetMs,
      getCurrentTime: () => this.#currentTime,
    });

    $effect(() => {
      this.props.timing.changeRevision;
      this.#updateCurrentTime();
      if (this.props.timing.query().velocity === 1) this.#startTracking();
      else this.#stopTracking();
    });

    $effect(() => () => this.#stopTracking());
  }

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

  get currentTime() {
    return this.#currentTime;
  }

  get lyrics() {
    return this.#lyrics;
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

  #updateCurrentTime() {
    this.#currentTime = this.props.timing.query().position;
  }

  #trackTime = () => {
    this.#updateCurrentTime();
    if (this.props.timing.query().velocity === 1) {
      this.#animationFrame = requestAnimationFrame(this.#trackTime);
    } else {
      this.#animationFrame = undefined;
    }
  };

  #startTracking() {
    if (this.#animationFrame !== undefined) {
      cancelAnimationFrame(this.#animationFrame);
    }
    this.#trackTime();
  }

  #stopTracking() {
    if (this.#animationFrame !== undefined) {
      cancelAnimationFrame(this.#animationFrame);
    }
    this.#animationFrame = undefined;
    this.#updateCurrentTime();
  }
}

const [getPlaybackContext, providePlaybackContext] = createContext<PlaybackContext>();

export function setPlaybackContext(props: PlaybackContextProps) {
  return providePlaybackContext(new PlaybackContext(props));
}

export function usePlayback() {
  return getPlaybackContext();
}
