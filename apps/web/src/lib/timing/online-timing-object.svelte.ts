import { queryTimingStateVector, translateProviderVector } from "./internal/state-vector";
import type { ProviderTimingState, TimingStateVector, TimingStateVectorUpdate } from "./types";
import type { ITimingObject, ITimingProvider, TTimingStateVectorUpdate } from "timing-object";

type ClockSample = {
  roundTrip: number;
  providerTimeOrigin: number;
};

type OptimisticTimingState = {
  expectedProviderRevision: number;
  requestSequence: number;
  vector: TimingStateVector;
};

/**
 * Functions that connect a room's timeline to the server. Here, "provider" means
 * the server that stores playback state and sends updates to everyone in the room.
 * @see {@link OnlineTimingObject} for creating and sharing a timeline.
 */
export type OnlineTimingObjectOptions = {
  /**
   * Returns the latest playback state received from the server, or undefined
   * while it is loading. Read Svelte reactive state here so changes are observed.
   */
  getProviderState: () => ProviderTimingState | undefined;
  /**
   * Returns the server's current time in seconds, using the same clock as
   * ProviderTimingState.vector.timestamp. Used to compare server and browser time.
   */
  readProviderClock: () => Promise<{ timestamp: number }>;
  /**
   * Sends a playback change and its start delay to the server. Reject the promise
   * if the change fails so the local timeline can undo its temporary change.
   */
  updateProvider: (
    update: TimingStateVectorUpdate,
    options: { playStartDelaySeconds: number },
  ) => void | Promise<void>;
  /**
   * How far ahead to schedule a playback start, in seconds; defaults to 1.
   * This gives each device time to prepare the media. The delay between producing
   * audio and hearing it is handled separately by SyncedMediaPlayback.
   * @see `$lib/synced-playback` for audio output delay handling.
   */
  playStartDelaySeconds?: number;
};

/**
 * Whether the timeline is waiting for server state and a clock estimate
 * (connecting), ready to use (open), or stopped by cleanup (closed).
 */
export type TimingObjectReadyState = "connecting" | "open" | "closed";

/**
 * Tracks where playback should be for everyone in a room. Import from `$lib/timing`.
 * A timeline contains a media position, playback speed, and the time they apply.
 *
 * Create one instance in the component that owns the room's playback state.
 * Construct it during Svelte component initialization, call start() on mount,
 * and share it with child players, lyrics, and playback controls.
 *
 * This class compares the server clock with the browser clock so query() can
 * calculate the room's current playback position without a network request.
 * Requested changes appear locally first; the server's response confirms or
 * corrects them.
 *
 * To play audio or video, pass this timeline to SyncedMediaPlayback from
 * `$lib/synced-playback`. That class controls the media element and accounts
 * for the delay before sound reaches the output device.
 *
 * @example Create and start a timeline using the room's server callbacks
 * ```svelte
 * <script lang="ts">
 *   import { onMount } from "svelte";
 *   import { OnlineTimingObject, type OnlineTimingObjectOptions } from "$lib/timing";
 *
 *   let { provider }: { provider: OnlineTimingObjectOptions } = $props();
 *   const timing = new OnlineTimingObject({
 *     getProviderState: () => provider.getProviderState(),
 *     readProviderClock: () => provider.readProviderClock(),
 *     updateProvider: (update, options) => provider.updateProvider(update, options),
 *   });
 *   onMount(() => timing.start());
 *   // Share `timing` with child players and lyrics through props or context.
 * </script>
 * ```
 *
 * @see {@link OnlineTimingObjectOptions} for the server functions this class needs.
 * @see {@link OnlineTimingObject.query} for lyric and progress time.
 * @see `$lib/synced-playback` for synchronized audio and video playback.
 * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#connecting-the-timing-object
 * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#state-vector-synchronization
 */
export class OnlineTimingObject extends EventTarget implements ITimingObject {
  readonly #options: OnlineTimingObjectOptions;
  /**
   * No fixed end time. Each media element supplies its own duration.
   */
  readonly endPosition = Number.POSITIVE_INFINITY;
  /**
   * Playback positions start at zero seconds.
   */
  readonly startPosition = 0;
  /**
   * Always null: server access uses the supplied callbacks, not a timing-object provider instance.
   */
  readonly timingProviderSource: ITimingProvider | null = null;
  /**
   * Called when playback state changes, including when a scheduled start takes effect.
   */
  onchange: ITimingObject["onchange"] = null;
  /**
   * Required by the timing-object interface; this class does not emit error events.
   * Failed update() calls reject their promise instead.
   */
  onerror: ITimingObject["onerror"] = null;
  /**
   * Called when readyState changes.
   */
  onreadystatechange: ITimingObject["onreadystatechange"] = null;
  #readyState = $state<TimingObjectReadyState>("connecting");
  #providerTimeOrigin = $state<number>();
  #uncertainty = $state(Number.POSITIVE_INFINITY);
  #changeRevision = $state(0);
  #samples: ClockSample[] = [];
  #changeTimer: number | undefined;
  #notifiedRevision: number | undefined;
  #notifiedProviderTimeOrigin: number | undefined;
  #optimisticState = $state<OptimisticTimingState>();
  #providerUpdateQueue: Promise<void> = Promise.resolve();
  #requestSequence = 0;

  /**
   * Creates the timeline and watches the supplied Svelte state. Call start() on
   * mount to begin measuring the difference between server and browser clocks.
   * @see {@link OnlineTimingObject} for a complete setup example.
   */
  constructor(options: OnlineTimingObjectOptions) {
    super();
    if (
      options.playStartDelaySeconds !== undefined &&
      (!Number.isFinite(options.playStartDelaySeconds) || options.playStartDelaySeconds < 0)
    ) {
      throw new Error("playStartDelaySeconds must be a finite non-negative number");
    }
    this.#options = options;
    $effect(() => {
      const state = options.getProviderState();
      const optimisticState = this.#optimisticState;
      const readyState = state && this.#providerTimeOrigin !== undefined ? "open" : "connecting";
      if (readyState !== this.#readyState) {
        this.#readyState = readyState;
        this.#emit("readystatechange");
      }
      if (state && optimisticState && state.revision >= optimisticState.expectedProviderRevision) {
        this.#optimisticState = undefined;
      }
      if (
        state &&
        readyState === "open" &&
        (state.revision !== this.#notifiedRevision ||
          this.#providerTimeOrigin !== this.#notifiedProviderTimeOrigin)
      ) {
        this.#notifiedRevision = state.revision;
        this.#notifiedProviderTimeOrigin = this.#providerTimeOrigin;
        this.#emit("change");
        this.#scheduleFutureChange();
      }
    });
  }

  #emit(type: "change" | "readystatechange") {
    if (type === "change") this.#changeRevision += 1;
    const event = new Event(type);
    this.dispatchEvent(event);
    const handler = type === "change" ? this.onchange : this.onreadystatechange;
    handler?.call(this, event);
  }

  #scheduleFutureChange() {
    if (this.#changeTimer !== undefined) window.clearTimeout(this.#changeTimer);
    this.#changeTimer = undefined;
    const timestamp = this.nextChangeTimestamp();
    if (timestamp === undefined) return;
    this.#changeTimer = window.setTimeout(
      () => {
        this.#changeTimer = undefined;
        this.#emit("change");
      },
      Math.max(0, (timestamp - performance.now() / 1_000) * 1_000),
    );
  }

  /**
   * Whether the timeline has enough server information to use. Wait for "open"
   * before reading playback time.
   * @see {@link TimingObjectReadyState}
   */
  get readyState() {
    return this.#readyState;
  }

  /**
   * Clock uncertainty estimate in seconds: half the fastest recent server request
   * round trip. Infinity until a request succeeds. This does not measure audio delay.
   */
  get uncertainty() {
    return this.#uncertainty;
  }

  /**
   * Version number of the latest playback state received from the server;
   * undefined before the first state arrives.
   */
  get revision() {
    return this.#options.getProviderState()?.revision;
  }

  /**
   * Counter that increases whenever local playback state changes. Svelte effects
   * can read it to react to seeks, pauses, and scheduled starts.
   */
  get changeRevision() {
    return this.#changeRevision;
  }

  /**
   * Requested playback speed: normally 1 for playing or 0 for paused. Includes
   * a scheduled start that has not happened yet, so controls can show Pause
   * while waiting for playback to begin.
   */
  get targetVelocity() {
    return (
      this.#optimisticState?.vector.velocity ?? this.#options.getProviderState()?.vector.velocity
    );
  }

  /**
   * Returns the room's playback position and speed at the requested browser time.
   * Omit localTimestamp to use the current time. Explicit timestamps are seconds
   * on the performance.now() clock, not Date.now() or a position in the media.
   *
   * Use the returned position for lyrics and progress UI. SyncedMediaPlayback
   * handles audio output delay separately; callers should not add that delay here.
   *
   * @example Read on each animation frame while playback is active
   * ```ts
   * const { position, velocity } = timing.query();
   * updateLyrics(position);
   * updateProgress(position, velocity);
   * ```
   * @see {@link OnlineTimingObject.readyState} for when the timeline is ready to read.
   */
  query(localTimestamp = performance.now() / 1_000): TimingStateVector {
    const optimisticState = this.#optimisticState;
    if (optimisticState) {
      return queryTimingStateVector(optimisticState.vector, localTimestamp);
    }
    const state = this.#options.getProviderState();
    const origin = this.#providerTimeOrigin;
    if (!state || origin === undefined) {
      return { position: 0, velocity: 0, acceleration: 0, timestamp: localTimestamp };
    }
    return queryTimingStateVector(translateProviderVector(state.vector, origin), localTimestamp);
  }

  /**
   * Returns when a pending playback change takes effect, in seconds on the
   * performance.now() clock. Returns undefined if no change is scheduled after
   * localTimestamp. The audio playback code uses this to schedule a wakeup.
   *
   * @see {@link OnlineTimingObject.query} for reading playback state at that time.
   */
  nextChangeTimestamp(localTimestamp = performance.now() / 1_000): number | undefined {
    const optimisticState = this.#optimisticState;
    if (optimisticState) {
      return optimisticState.vector.timestamp > localTimestamp
        ? optimisticState.vector.timestamp
        : undefined;
    }
    const state = this.#options.getProviderState();
    const origin = this.#providerTimeOrigin;
    if (!state || origin === undefined) return undefined;
    const timestamp = state.vector.timestamp - origin;
    return timestamp > localTimestamp ? timestamp : undefined;
  }

  /**
   * Requests a playback change for everyone in the room. Applies a temporary
   * local change while the server request is pending, then uses the server's
   * response. Rejects if the timeline is not ready or the request fails.
   *
   * Player buttons should call SyncedMediaPlayback's request methods. Those
   * methods check canControl before calling this lower-level method.
   * @see `$lib/synced-playback` for the player control API.
   */
  async update(update: TimingStateVectorUpdate | TTimingStateVectorUpdate) {
    if (this.#readyState !== "open") throw new Error("Timing resource is not connected");
    const providerState = this.#options.getProviderState();
    if (!providerState) throw new Error("Timing resource has no provider state");
    const localTimestamp = performance.now() / 1_000;
    const current = this.query(localTimestamp);
    const velocity = update.velocity ?? this.targetVelocity ?? current.velocity;
    const playStartDelaySeconds = this.#options.playStartDelaySeconds ?? 1;
    const requestSequence = ++this.#requestSequence;
    const previousExpectedRevision = this.#optimisticState?.expectedProviderRevision;
    const expectedProviderRevision =
      previousExpectedRevision === undefined
        ? providerState.revision + 1
        : Math.max(providerState.revision, previousExpectedRevision) + 1;
    this.#optimisticState = {
      expectedProviderRevision,
      requestSequence,
      vector: {
        position: update.position ?? current.position,
        velocity,
        acceleration: update.acceleration ?? current.acceleration,
        timestamp: localTimestamp + (velocity === 0 ? 0 : playStartDelaySeconds),
      },
    };
    this.#emit("change");
    this.#scheduleFutureChange();

    const providerUpdate = this.#providerUpdateQueue.then(() =>
      this.#options.updateProvider(
        {
          position: update.position ?? undefined,
          velocity: update.velocity ?? undefined,
          acceleration: update.acceleration ?? undefined,
        },
        { playStartDelaySeconds },
      ),
    );
    this.#providerUpdateQueue = providerUpdate.then(
      () => undefined,
      () => undefined,
    );
    try {
      await providerUpdate;
    } catch (cause) {
      const optimisticState = this.#optimisticState;
      if (optimisticState?.requestSequence === requestSequence) {
        this.#optimisticState = undefined;
      } else if (
        optimisticState &&
        optimisticState.expectedProviderRevision >= expectedProviderRevision
      ) {
        this.#optimisticState = {
          ...optimisticState,
          expectedProviderRevision: optimisticState.expectedProviderRevision - 1,
        };
      }
      this.#emit("change");
      this.#scheduleFutureChange();
      throw cause;
    }
  }

  async #sampleClock() {
    const startedAt = performance.now() / 1_000;
    const { timestamp } = await this.#options.readProviderClock();
    const completedAt = performance.now() / 1_000;
    this.#samples = [
      ...this.#samples.slice(-11),
      {
        roundTrip: completedAt - startedAt,
        providerTimeOrigin: timestamp - (startedAt + completedAt) / 2,
      },
    ];
    const candidates = [...this.#samples]
      .sort((left, right) => left.roundTrip - right.roundTrip)
      .slice(0, 3);
    const origins = candidates
      .map(({ providerTimeOrigin }) => providerTimeOrigin)
      .sort((left, right) => left - right);
    this.#providerTimeOrigin = origins[Math.floor(origins.length / 2)];
    this.#uncertainty = candidates[0].roundTrip / 2;
  }

  async #synchronize(sampleCount: number) {
    for (let index = 0; index < sampleCount; index += 1) {
      try {
        await this.#sampleClock();
      } catch {
        // Retain the last provider clock estimate until a later sample succeeds.
      }
    }
  }

  /**
   * Starts periodic server clock measurements. The timeline becomes ready once
   * it has both server playback state and a clock estimate.
   *
   * Call once from the owning component's onMount. Return the cleanup function
   * as shown below so measurements stop when the component is destroyed.
   * @example
   * ```ts
   * onMount(() => timing.start());
   * ```
   * @see {@link OnlineTimingObject} for the room component setup example.
   */
  start() {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void this.#synchronize(3);
    };
    void this.#synchronize(5);
    const timer = window.setInterval(() => void this.#synchronize(1), 30_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      if (this.#changeTimer !== undefined) window.clearTimeout(this.#changeTimer);
      this.#changeTimer = undefined;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      this.#optimisticState = undefined;
      this.#readyState = "closed";
      this.#emit("readystatechange");
    };
  }
}
