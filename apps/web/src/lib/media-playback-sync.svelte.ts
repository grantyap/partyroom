import type { OnlineTimingObject } from "$lib/timing";
import {
  createSetTimingsrc,
  createUpdateGradually,
  createUpdateStepwise,
  setTimingsrcWithCustomUpdateFunction,
} from "timingsrc";
import type { MediaSeekRequestEvent } from "vidstack";

/** Configuration for connecting a media element to an online Timing Object. */
export type MediaPlaybackSyncOptions = {
  /** Returns the media element that follows the Timing Object. */
  getElement: () => HTMLVideoElement | undefined;
  /** Returns the authoritative Timing Object for the current media resource. */
  getTimingObject: () => OnlineTimingObject | undefined;
  /** Maximum ignored playhead error in seconds; defaults to `timingsrc`'s 0.025. */
  alignmentToleranceSeconds?: number;
  /** Whether this client may send transport updates to the shared timing resource. */
  canControl?: () => boolean;
  /** Advances to the next media resource when the transport requests a skip. */
  onSkip?: () => void | Promise<void>;
};

const DEFAULT_ALIGNMENT_TOLERANCE_SECONDS = 0.025;
const DEFAULT_GRADUAL_THRESHOLD_SECONDS = 1;
const DEFAULT_GRADUAL_TIME_CONSTANT_SECONDS = 0.5;
const disconnectTimingsrcKey = Symbol.for("partyroom.media-playback-sync.disconnect");

type ManagedVideoElement = HTMLVideoElement & {
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
 * Connects one `HTMLVideoElement` to Partyroom's W3C-style Timing Object.
 *
 * This is the required entry point for anything that changes video playback.
 * Play, pause, seek, skip, resume, and future transport controls must be routed
 * through this class so the local media element stays synchronized with the
 * server's authoritative timing state.
 *
 * Browser-specific time alignment is delegated to the maintained `timingsrc`
 * library. Partyroom retains only Svelte lifecycle integration, autoplay
 * recovery, and diagnostics. It does not modify vectors before handing them to
 * `timingsrc`, since doing so can preserve a stale browser playhead after a seek.
 * Connection ownership is stored on the media element so hot module replacement
 * cannot leave multiple alignment loops controlling one preserved element.
 *
 * @see https://github.com/chrisguttandin/timingsrc
 * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#time-align-media-element-with-timing-object
 */
export class MediaPlaybackSync {
  readonly #options: MediaPlaybackSyncOptions;
  #needsUserGesture = $state(false);
  #error = $state<string | null>(null);
  #alignmentErrorSeconds = $state<number>();
  #mediaTimelineRevision = $state(0);
  readonly #alignmentToleranceSeconds: number;

  /** Whether autoplay policy requires a local gesture to join playback. */
  get needsUserGesture() {
    return this.#needsUserGesture;
  }

  /** Error from the most recent user-gesture synchronization attempt. */
  get error() {
    return this.#error;
  }

  /** Latest ideal-minus-element media error, in seconds. */
  get alignmentErrorSeconds() {
    return this.#alignmentErrorSeconds;
  }

  /** Current half-round-trip bound on provider clock translation, in seconds. */
  get clockUncertaintySeconds() {
    return this.#options.getTimingObject()?.uncertainty;
  }

  /** Maximum playhead error ignored by the browser-specific alignment algorithm. */
  get alignmentToleranceSeconds() {
    return this.#alignmentToleranceSeconds;
  }

  /** Creates a `timingsrc` media follower inside the current Svelte effect context. */
  constructor(options: MediaPlaybackSyncOptions) {
    const alignmentToleranceSeconds =
      options.alignmentToleranceSeconds ?? DEFAULT_ALIGNMENT_TOLERANCE_SECONDS;
    if (!Number.isFinite(alignmentToleranceSeconds) || alignmentToleranceSeconds < 0) {
      throw new Error("alignmentToleranceSeconds must be a finite non-negative number");
    }
    this.#options = options;
    this.#alignmentToleranceSeconds = alignmentToleranceSeconds;
    $effect(() => {
      this.#mediaTimelineRevision;
      const element = options.getElement() as ManagedVideoElement | undefined;
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
        if (vector.velocity === 1 && element.paused) {
          this.#needsUserGesture = true;
        } else if (vector.velocity === 0 || !element.paused) {
          this.#needsUserGesture = false;
        }
      }, 500);
      return () => window.clearInterval(timer);
    });
  }

  /** Refreshes diagnostics; `timingsrc` performs the actual reconciliation. */
  readonly align = () => {
    const element = this.#options.getElement();
    const timing = this.#options.getTimingObject();
    if (!element || !timing) return;
    this.#alignmentErrorSeconds = timing.query().position - element.currentTime;
  };

  /** Clears autoplay recovery state after frames actually resume. */
  readonly handlePlaying = () => {
    this.#needsUserGesture = false;
    this.#error = null;
  };

  /** Refreshes alignment diagnostics when media becomes playable. */
  readonly handleCanPlay = () => {
    this.align();
  };

  /** Reconnects `timingsrc` after a media resource exposes its duration and seekable timeline. */
  readonly handleLoadedMetadata = () => {
    this.#mediaTimelineRevision += 1;
    this.align();
  };

  /** Requests shared playback through the authoritative timing resource. */
  readonly handlePlayRequest = () => {
    this.#updateTiming({ velocity: 1 });
  };

  /** Requests a shared pause through the authoritative timing resource. */
  readonly handlePauseRequest = () => {
    this.#updateTiming({ velocity: 0 });
  };

  /** Requests a shared seek through the authoritative timing resource. */
  readonly handleSeekRequest = (position: number) => {
    this.#updateTiming({ position });
  };

  /** Requests the next media resource through the injected room transport action. */
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

  /** Intercepts Vidstack transport requests when playback is timing-resource-backed. */
  readonly handleControlRequest = (event: Event) => {
    if (!this.#options.getTimingObject()) return;
    event.preventDefault();
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

  /** Rejoins authoritative playback from a browser-approved user gesture. */
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
      if (vector.velocity === 1) await element.play();
      else element.pause();
      this.#needsUserGesture = false;
    } catch {
      this.#needsUserGesture = true;
      this.#error = "Safari still blocked playback. Tap Sync video again.";
    }
  };
}
