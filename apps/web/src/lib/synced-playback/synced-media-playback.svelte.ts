import type { OnlineTimingObject } from "$lib/timing";
import { MediaAudioOutput } from "./internal/media-audio-output";
import { untrack } from "svelte";
import {
  createSetTimingsrc,
  createUpdateGradually,
  createUpdateStepwise,
  setTimingsrcWithCustomUpdateFunction,
} from "timingsrc";
import type { MediaSeekRequestEvent } from "vidstack";

/**
 * The media element to play, the room timeline to follow, and who may control it.
 * @see {@link SyncedMediaPlayback} for an audio or video player example.
 */
export type SyncedMediaPlaybackOptions = {
  /**
   * Returns the audio or video element, or undefined before it mounts. Read
   * Svelte reactive state here so replacing the element updates the controller.
   * For media on another origin, set crossOrigin before src and configure the
   * media server to allow CORS requests; Web Audio needs that access.
   */
  getElement: () => HTMLMediaElement | undefined;
  /**
   * Returns the room's shared timeline, or undefined before it is available.
   * @see {@link OnlineTimingObject} for creating the timeline.
   */
  getTimingObject: () => OnlineTimingObject | undefined;
  /**
   * Largest difference, in seconds, between the media position and room timeline
   * that can be left uncorrected. Defaults to 0.025 (25 milliseconds).
   */
  alignmentToleranceSeconds?: number;
  /**
   * Returns whether this user may change playback for everyone. Defaults to true.
   * Local autoplay recovery through resume() is available even when this is false.
   */
  canControl?: () => boolean;
  /**
   * Callback that selects the next item in the room when handleSkipRequest() is called.
   */
  onSkip?: () => void | Promise<void>;
};

const DEFAULT_ALIGNMENT_TOLERANCE_SECONDS = 0.025;
const DEFAULT_GRADUAL_THRESHOLD_SECONDS = 1;
const DEFAULT_GRADUAL_TIME_CONSTANT_SECONDS = 0.5;
const disconnectTimingsrcKey = Symbol.for("partyroom.media-playback-sync.disconnect");

type ManagedMediaElement = HTMLMediaElement & {
  [disconnectTimingsrcKey]?: () => void;
};

const computeGradualVelocity = (
  delta: number,
  minimum: number,
  maximum: number,
  velocity: number,
) => {
  const factor =
    (Math.abs(delta) + DEFAULT_GRADUAL_TIME_CONSTANT_SECONDS) /
    DEFAULT_GRADUAL_TIME_CONSTANT_SECONDS;
  return Math.max(minimum, Math.min(maximum, delta > 0 ? velocity / factor : factor * velocity));
};

const supportedPlaybackRateRange = () => {
  const audio = new Audio();
  try {
    audio.playbackRate = 17;
  } catch {
    return [0.0625, 16] as const;
  }
  try {
    audio.playbackRate = -1;
  } catch {
    return [0, Number.MAX_VALUE] as const;
  }
  return [Number.MIN_VALUE, Number.MAX_VALUE] as const;
};

const createConfiguredTimingsrc = (alignmentToleranceSeconds: number) => {
  const usesStepwiseAlignment =
    navigator.userAgent.includes("Safari") && !navigator.userAgent.includes("Chrome");
  if (usesStepwiseAlignment) {
    return createSetTimingsrc(
      setTimingsrcWithCustomUpdateFunction,
      createUpdateStepwise(alignmentToleranceSeconds),
    );
  }
  return createSetTimingsrc(
    setTimingsrcWithCustomUpdateFunction,
    createUpdateGradually(
      computeGradualVelocity,
      supportedPlaybackRateRange(),
      DEFAULT_GRADUAL_THRESHOLD_SECONDS,
      alignmentToleranceSeconds,
    ),
  );
};

/**
 * Plays audio or video in time with everyone else in the room, accounting for
 * the delay before sound reaches this device's output. Import from `$lib/synced-playback`.
 *
 * Create during Svelte component initialization. Pass an audio or video element
 * and the room's OnlineTimingObject. This controller keeps playback in sync,
 * handles media events and volume changes, and cleans up when the component
 * is destroyed. It also handles changes to the media source.
 *
 * Use its play, pause, and seek request methods for your buttons. Native media
 * controls change only the local element and bypass the room's shared playback.
 * When needsUserGesture is true, show a join button that calls resume().
 *
 * The supplied element follows the room timeline. A second audio element plays
 * the sound slightly ahead to allow for output delay. This requires an additional
 * media load and decoder. On supported browsers, the delay estimate combines
 * AudioContext.baseLatency and outputLatency. If compensation is unavailable,
 * playback continues without it. iPhone and iPad use a single media element to
 * avoid competing playback sessions; estimates do not guarantee exact audible sync.
 * Read the shared timeline for lyrics and progress UI without adding an offset.
 *
 * @example Audio-only Svelte player (use HTMLVideoElement for video)
 * ```svelte
 * <script lang="ts">
 *   import { SyncedMediaPlayback } from "$lib/synced-playback";
 *   import type { OnlineTimingObject } from "$lib/timing";
 *
 *   let { src, timing }: { src: string; timing: OnlineTimingObject } = $props();
 *   let audio = $state<HTMLAudioElement>();
 *   const playback = new SyncedMediaPlayback({
 *     getElement: () => audio,
 *     getTimingObject: () => timing,
 *   });
 * </script>
 *
 * <audio bind:this={audio} crossorigin="anonymous" {src} preload="auto"></audio>
 * <button onclick={playback.handlePlayRequest}>Play for everyone</button>
 * <button onclick={playback.handlePauseRequest}>Pause for everyone</button>
 * {#if playback.needsUserGesture}
 *   <button onclick={() => void playback.resume()}>Join playback</button>
 * {/if}
 * ```
 *
 * @see {@link OnlineTimingObject} for creating and sharing the room timeline.
 * @see {@link SyncedMediaPlayback.handleControlRequest} for Vidstack integration.
 * @see {@link SyncedMediaPlayback.resume} for letting a user join playback when the browser blocks it.
 */
export class SyncedMediaPlayback {
  readonly #options: SyncedMediaPlaybackOptions;
  #needsUserGesture = $state(false);
  #error = $state<string | null>(null);
  #alignmentErrorSeconds = $state<number>();
  #mediaTimelineRevision = $state(0);
  #audioOutput: MediaAudioOutput | undefined;
  #audioOutputDelaySeconds = $state(0);
  #audioCompensationActive = $state(false);
  readonly #alignmentToleranceSeconds: number;

  /**
   * Whether playback needs a user interaction to start or resume on this device.
   * Show a join button that calls resume() from its click handler.
   * @see {@link SyncedMediaPlayback.resume}
   */
  get needsUserGesture() {
    return this.#needsUserGesture;
  }

  /**
   * Error message from the last resume() attempt, or null if none is recorded.
   */
  get error() {
    return this.#error;
  }

  /**
   * Room position minus the media element's current position, in seconds.
   * Positive means the element is behind. Undefined before the first measurement.
   * This measures the playback position, not when sound is actually heard.
   */
  get alignmentErrorSeconds() {
    return this.#alignmentErrorSeconds;
  }

  /**
   * Estimated error in matching the browser clock to the server clock, in seconds.
   * Undefined when no timeline is attached.
   * @see {@link OnlineTimingObject.uncertainty} for how the estimate is calculated.
   */
  get clockUncertaintySeconds() {
    return this.#options.getTimingObject()?.uncertainty;
  }

  /**
   * Largest playback position error, in seconds, that is left uncorrected.
   */
  get alignmentToleranceSeconds() {
    return this.#alignmentToleranceSeconds;
  }

  /**
   * Estimated delay between processing audio and the device playing it, in seconds.
   * Zero when no usable estimate is available. Check audioCompensationActive to see
   * whether playback is using the estimate.
   * @see {@link SyncedMediaPlayback.audioCompensationActive}
   */
  get audioOutputDelaySeconds() {
    return this.#audioOutputDelaySeconds;
  }
  /**
   * Whether sound is currently routed through the audio player that accounts for output delay.
   */
  get audioCompensationActive() {
    return this.#audioCompensationActive;
  }

  /**
   * Connects a media element to the room timeline. Call during Svelte component
   * initialization. Changes to the supplied getters are observed automatically;
   * event listeners and audio resources are cleaned up when the component is destroyed.
   * @see {@link SyncedMediaPlayback} for a complete usage example.
   */
  constructor(options: SyncedMediaPlaybackOptions) {
    const alignmentToleranceSeconds =
      options.alignmentToleranceSeconds ?? DEFAULT_ALIGNMENT_TOLERANCE_SECONDS;
    if (!Number.isFinite(alignmentToleranceSeconds) || alignmentToleranceSeconds < 0) {
      throw new Error("alignmentToleranceSeconds must be a finite non-negative number");
    }
    this.#options = options;
    this.#alignmentToleranceSeconds = alignmentToleranceSeconds;
    $effect(() => {
      const element = options.getElement();
      if (!element) return;
      element.addEventListener("playing", this.#handlePlaying);
      element.addEventListener("canplay", this.#handleCanPlay);
      element.addEventListener("loadedmetadata", this.#handleLoadedMetadata);
      return () => {
        element.removeEventListener("playing", this.#handlePlaying);
        element.removeEventListener("canplay", this.#handleCanPlay);
        element.removeEventListener("loadedmetadata", this.#handleLoadedMetadata);
      };
    });
    $effect(() => {
      const element = options.getElement();
      const timing = options.getTimingObject();
      if (!element || !timing || timing.readyState !== "open") return;
      const output = untrack(() =>
        MediaAudioOutput.create(
          element,
          timing,
          createConfiguredTimingsrc(alignmentToleranceSeconds),
        ),
      );
      this.#audioOutput = output;
      return () => {
        output?.dispose();
        if (this.#audioOutput === output) this.#audioOutput = undefined;
      };
    });
    $effect(() => {
      this.#mediaTimelineRevision;
      const element = options.getElement() as ManagedMediaElement | undefined;
      const timing = options.getTimingObject();
      if (!element || !timing || timing.readyState !== "open") return;
      element[disconnectTimingsrcKey]?.();
      const disconnectTimingsrc = createConfiguredTimingsrc(alignmentToleranceSeconds)(
        element,
        timing,
      );
      let connected = true;
      const release = () => {
        if (!connected) return;
        connected = false;
        disconnectTimingsrc();
        if (element[disconnectTimingsrcKey] === release) {
          delete element[disconnectTimingsrcKey];
        }
      };
      element[disconnectTimingsrcKey] = release;
      return release;
    });
    $effect(() => {
      const element = options.getElement();
      const timing = options.getTimingObject();
      if (!element || !timing) return;
      const timer = window.setInterval(() => {
        const vector = timing.query();
        this.#alignmentErrorSeconds = vector.position - element.currentTime;
        this.#audioOutputDelaySeconds = this.#audioOutput?.delaySeconds ?? 0;
        this.#audioCompensationActive = this.#audioOutput?.active ?? false;
        if (this.#audioOutput?.needsUserGesture || (vector.velocity === 1 && element.paused)) {
          this.#needsUserGesture = true;
        } else if (vector.velocity === 0 || !element.paused) {
          this.#needsUserGesture = false;
        }
      }, 500);
      return () => window.clearInterval(timer);
    });
  }

  /**
   * Updates alignmentErrorSeconds. This method only measures the position;
   * the controller's ongoing synchronization loop corrects playback automatically.
   * @see {@link SyncedMediaPlayback.alignmentErrorSeconds}
   */
  readonly align = () => {
    const element = this.#options.getElement();
    const timing = this.#options.getTimingObject();
    if (!element || !timing) return;
    this.#alignmentErrorSeconds = timing.query().position - element.currentTime;
  };

  /**
   * Clears a previous playback error and checks whether audio still needs a user interaction.
   */
  readonly #handlePlaying = () => {
    this.#needsUserGesture = this.#audioOutput?.needsUserGesture ?? false;
    this.#error = null;
  };

  /**
   * Measures the playback position once the browser has enough media data to play.
   */
  readonly #handleCanPlay = () => {
    this.align();
  };

  /**
   * Restarts position correction once the browser knows the media duration and seek range.
   */
  readonly #handleLoadedMetadata = () => {
    this.#mediaTimelineRevision += 1;
    this.align();
  };

  /**
   * Asks the server to start playback for everyone, if canControl allows it.
   */
  readonly handlePlayRequest = () => {
    this.#updateTiming({ velocity: 1 });
  };

  /**
   * Asks the server to pause playback for everyone, if canControl allows it.
   */
  readonly handlePauseRequest = () => {
    this.#updateTiming({ velocity: 0 });
  };

  /**
   * Asks the server to move everyone to a position in the media, in seconds.
   * Ignored when canControl returns false.
   * @example
   * ```ts
   * playback.handleSeekRequest(60); // Seek everyone to one minute.
   * ```
   */
  readonly handleSeekRequest = (position: number) => {
    this.#updateTiming({ position });
  };

  /**
   * Calls onSkip to select the next item, if canControl allows it.
   */
  readonly handleSkipRequest = () => {
    if (!this.#canControl()) return;
    try {
      void Promise.resolve(this.#options.onSkip?.()).catch((cause: unknown) => {
        console.error("Unable to skip media", cause);
      });
    } catch (cause) {
      console.error("Unable to skip media", cause);
    }
  };

  /**
   * Connects Vidstack's play, pause, and seek buttons to shared room playback.
   * Listen on the media-player element during the capture phase so this handler
   * runs before Vidstack changes local playback. Remove those listeners on cleanup.
   * The controller already listens for ordinary media events such as playing.
   *
   * @example Inside a Svelte action attached to the Vidstack media-player
   * ```ts
   * const types = ["media-play-request", "media-pause-request",
   *   "media-seeking-request", "media-seek-request"];
   * for (const type of types) {
   *   node.addEventListener(type, playback.handleControlRequest, true);
   * }
   * return { destroy() {
   *   for (const type of types) {
   *     node.removeEventListener(type, playback.handleControlRequest, true);
   *   }
   * } };
   * ```
   * @see {@link SyncedMediaPlayback.handlePlayRequest} for custom controls.
   */
  readonly handleControlRequest = (event: Event) => {
    if (!this.#options.getTimingObject()) return;
    event.preventDefault();
    // A transport gesture also unlocks the local audio device, even for viewers.
    void this.#audioOutput?.resume().catch(() => {
      this.#needsUserGesture = true;
    });
    if (!this.#canControl()) return;
    switch (event.type) {
      case "media-play-request":
        this.handlePlayRequest();
        break;
      case "media-pause-request":
        this.handlePauseRequest();
        break;
      case "media-seek-request":
        this.handleSeekRequest((event as MediaSeekRequestEvent).detail);
    }
  };

  #canControl() {
    return this.#options.canControl?.() ?? true;
  }

  #updateTiming(update: { position?: number; velocity?: 0 | 1 }) {
    const timing = this.#options.getTimingObject();
    if (!timing || !this.#canControl()) return;
    void timing.update(update).catch((cause: unknown) => {
      console.error("Unable to update timing resource", cause);
    });
  }

  /**
   * Joins the room's current playback on this device. Call directly from a click
   * or tap handler so the browser allows audio to play. This does not change
   * anyone else's playback, and users without control permission may call it.
   * If playback is still blocked, sets error and keeps needsUserGesture true.
   * @example
   * ```svelte
   * <button onclick={() => void playback.resume()}>Join playback</button>
   * ```
   * @see {@link SyncedMediaPlayback.needsUserGesture}
   * @see {@link SyncedMediaPlayback.error}
   */
  readonly resume = async () => {
    const element = this.#options.getElement();
    const timing = this.#options.getTimingObject();
    if (!element || !timing) return;
    const vector = timing.query();
    this.#error = null;
    element.currentTime = Math.min(
      vector.position,
      Number.isFinite(element.duration) ? element.duration : vector.position,
    );
    try {
      const audioResume = this.#audioOutput?.resume();
      const mediaPlay = vector.velocity === 1 ? element.play() : Promise.resolve(element.pause());
      await Promise.all([audioResume, mediaPlay]);
      this.#needsUserGesture = false;
    } catch {
      this.#needsUserGesture = true;
      this.#error = "Playback is still blocked. Try joining playback again.";
    }
  };
}
