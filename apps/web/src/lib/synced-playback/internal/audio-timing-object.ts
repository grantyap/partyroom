import type { ITimingObject, ITimingProvider } from "timing-object";
import type { TimingStateVector } from "$lib/timing";

type AudioTimingSource = ITimingObject & {
  query(timestamp?: number): TimingStateVector;
  nextChangeTimestamp(timestamp?: number): number | undefined;
};

/**
 * Internal clock used by the separate audio player. It reads the room timeline
 * slightly ahead by the audio output delay, in seconds. The room timeline and
 * visible player's position stay unchanged. Updates through this clock are rejected.
 *
 * @see `$lib/synced-playback` for the controller that creates and manages this clock.
 */
export class AudioTimingObject extends EventTarget implements ITimingObject {
  readonly timingProviderSource: ITimingProvider | null = null;
  onchange: ITimingObject["onchange"] = null;
  onerror: ITimingObject["onerror"] = null;
  onreadystatechange: ITimingObject["onreadystatechange"] = null;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly source: AudioTimingSource,
    readonly getDelay: () => number,
  ) {
    super();
    source.addEventListener("change", this.refresh);
    source.addEventListener("readystatechange", this.refresh);
    this.refresh();
  }

  get readyState() {
    return this.source.readyState;
  }
  get startPosition() {
    return this.source.startPosition;
  }
  get endPosition() {
    return this.source.endPosition;
  }

  query() {
    const now = performance.now() / 1_000;
    // Query the source in the future, rather than extrapolating a paused query:
    // this preserves scheduled starts, pauses, and seeks.
    return { ...this.source.query(now + this.getDelay()), timestamp: now };
  }

  async update() {
    throw new Error("Audio output timing is read-only; use the shared transport controls");
  }

  readonly refresh = () => {
    clearTimeout(this.#timer);
    const now = performance.now() / 1_000;
    const delay = this.getDelay();
    const next = this.source.nextChangeTimestamp(now + delay);
    if (next !== undefined) {
      this.#timer = setTimeout(this.refresh, Math.max(1, (next - now - delay) * 1_000));
    }
    this.dispatchEvent(new Event("change"));
  };

  dispose() {
    clearTimeout(this.#timer);
    this.source.removeEventListener("change", this.refresh);
    this.source.removeEventListener("readystatechange", this.refresh);
  }
}
