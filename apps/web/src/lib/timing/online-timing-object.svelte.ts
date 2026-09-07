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
 * queried locally. Update requests immediately install a provisional local
 * vector, then reconcile it with the revision Convex multicasts to every client.
 * Provider timestamps remain authoritative once that revision arrives.
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
  #changeRevision = $state(0);
  #samples: ClockSample[] = [];
  #changeTimer: number | undefined;
  #notifiedRevision: number | undefined;
  #notifiedProviderTimeOrigin: number | undefined;
  #optimisticState = $state<OptimisticTimingState>();
  #providerUpdateQueue: Promise<void> = Promise.resolve();
  #requestSequence = 0;

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

  /** Monotonically increasing revision of the effective local vector. */
  get changeRevision() {
    return this.#changeRevision;
  }

  /**
   * Velocity requested by the latest provider vector, including a future-dated
   * vector that has not activated yet. Controls use this authoritative intent
   * so a scheduled or active play operation can always be paused.
   */
  get targetVelocity() {
    return (
      this.#optimisticState?.vector.velocity ?? this.#options.getProviderState()?.vector.velocity
    );
  }

  /**
   * Queries the timing resource at a local monotonic timestamp. The returned
   * vector comes from the latest provisional update until the provider
   * acknowledges it, then from the provider's authoritative notification.
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
   * Returns the future vector's activation timestamp in the local monotonic
   * clock domain. Media followers use it to schedule playback at the provider's
   * exact instant instead of starting whenever a network notification arrives.
   *
   * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#process-a-timing-provider-statevector-change-notification
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
   * Applies a partial state-vector update optimistically, then forwards it to the
   * provider. The provisional vector is replaced by the provider revision or
   * rolled back if the update fails.
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
      this.#optimisticState = undefined;
      this.#readyState = "closed";
      this.#emit("readystatechange");
    };
  }
}
