import {
  queryTimingStateVector,
  translateProviderVector,
  type ProviderTimingState,
  type TimingStateVector,
  type TimingStateVectorUpdate,
} from "$lib/timing-object";
import type { ITimingObject, ITimingProvider, TTimingStateVectorUpdate } from "timing-object";

type ClockSample = {
  roundTrip: number;
  providerTimeOrigin: number;
};

/** Configuration for a provider-backed W3C-style Timing Object. */
export type OnlineTimingObjectOptions = {
  /** Reads the most recent vector multicast by the online provider. */
  getProviderState: () => ProviderTimingState | undefined;
  /** Samples the provider clock for translation to `performance.now()`. */
  readProviderClock: () => Promise<{ timestamp: number }>;
  /** Forwards an update and its requested playback lead time to the provider. */
  updateProvider: (
    update: TimingStateVectorUpdate,
    options: { playStartDelaySeconds: number },
  ) => void | Promise<void>;
  /** Decoder-preparation lead time applied whenever the resulting vector plays. */
  playStartDelaySeconds?: number;
};

/** Connection state of the local proxy for Partyroom's online timing resource. */
export type TimingObjectReadyState = "connecting" | "open" | "closed";

/**
 * A local W3C-style Timing Object backed by Partyroom's online timing resource.
 *
 * Provider vectors are translated into the `performance.now()` clock domain and
 * queried locally. Update requests are only forwarded: this object deliberately
 * keeps its old vector until Convex multicasts the provider's resulting state to
 * every subscriber, including the client that initiated the request.
 *
 * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#connecting-the-timing-object
 * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#state-vector-synchronization
 */
export class OnlineTimingObject extends EventTarget implements ITimingObject {
  readonly #options: OnlineTimingObjectOptions;
  /** Unbounded upper position limit required by the `timing-object` interface. */
  readonly endPosition = Number.POSITIVE_INFINITY;
  /** Earliest valid media position. */
  readonly startPosition = 0;
  /** No local library provider is exposed because Convex is the remote provider. */
  readonly timingProviderSource: ITimingProvider | null = null;
  /** Event-handler property invoked when the effective timing vector changes. */
  onchange: ITimingObject["onchange"] = null;
  /** Event-handler property reserved for timing-provider errors. */
  onerror: ITimingObject["onerror"] = null;
  /** Event-handler property invoked when the connection state changes. */
  onreadystatechange: ITimingObject["onreadystatechange"] = null;
  #readyState = $state<TimingObjectReadyState>("connecting");
  #providerTimeOrigin = $state<number>();
  #uncertainty = $state(Number.POSITIVE_INFINITY);
  #samples: ClockSample[] = [];
  #changeTimer: number | undefined;
  #notifiedRevision: number | undefined;
  #notifiedProviderTimeOrigin: number | undefined;

  /**
   * Creates a local proxy without starting provider clock synchronization.
   * `playStartDelaySeconds` defaults to one second; tune it to the slowest
   * client's typical decoder preparation time.
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
      const readyState = state && this.#providerTimeOrigin !== undefined ? "open" : "connecting";
      if (readyState !== this.#readyState) {
        this.#readyState = readyState;
        this.#emit("readystatechange");
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

  /** Current connection state for the online timing resource. */
  get readyState() {
    return this.#readyState;
  }

  /** Best half-round-trip bound for the provider clock translation, in seconds. */
  get uncertainty() {
    return this.#uncertainty;
  }

  /** Latest provider change revision, or undefined before the first vector arrives. */
  get revision() {
    return this.#options.getProviderState()?.revision;
  }

  /**
   * Velocity requested by the latest provider vector, including a future-dated
   * vector that has not activated yet. Controls use this authoritative intent
   * so a scheduled or active play operation can always be paused.
   */
  get targetVelocity() {
    return this.#options.getProviderState()?.vector.velocity;
  }

  /**
   * Queries the timing resource at a local monotonic timestamp. The returned
   * vector is wholly derived from the latest provider notification.
   */
  query(localTimestamp = performance.now() / 1_000): TimingStateVector {
    const state = this.#options.getProviderState();
    const origin = this.#providerTimeOrigin;
    if (!state || origin === undefined) {
      return { position: 0, velocity: 0, acceleration: 0, timestamp: localTimestamp };
    }
    return queryTimingStateVector(translateProviderVector(state.vector, origin), localTimestamp);
  }

  /**
   * Returns the future vector's activation timestamp in the local monotonic
   * clock domain. Media followers use it to schedule playback at the provider's
   * exact instant instead of starting whenever a network notification arrives.
   *
   * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#process-a-timing-provider-statevector-change-notification
   */
  nextChangeTimestamp(localTimestamp = performance.now() / 1_000): number | undefined {
    const state = this.#options.getProviderState();
    const origin = this.#providerTimeOrigin;
    if (!state || origin === undefined) return undefined;
    const timestamp = state.vector.timestamp - origin;
    return timestamp > localTimestamp ? timestamp : undefined;
  }

  /**
   * Forwards a partial state-vector update to the provider without changing the
   * local vector. Callers observe the result only after the provider notification.
   */
  async update(update: TimingStateVectorUpdate | TTimingStateVectorUpdate) {
    if (this.#readyState !== "open") throw new Error("Timing resource is not connected");
    await this.#options.updateProvider(
      {
        position: update.position ?? undefined,
        velocity: update.velocity ?? undefined,
        acceleration: update.acceleration ?? undefined,
      },
      {
        playStartDelaySeconds: this.#options.playStartDelaySeconds ?? 1,
      },
    );
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
   * Starts clock synchronization and returns its lifecycle cleanup. Invoke this
   * from `onMount`; the timing object remains connecting until it has both a
   * provider vector and a clock estimate.
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
      this.#readyState = "closed";
      this.#emit("readystatechange");
    };
  }
}
