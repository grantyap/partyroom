import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { ITimingObject, ITimingProvider } from "timing-object";
import { AudioTimingObject } from "./audio-timing-object";
import type { TimingStateVector } from "$lib/timing";
import { queryTimingStateVector } from "$lib/timing/internal/state-vector";

class Source extends EventTarget implements ITimingObject {
  readonly timingProviderSource: ITimingProvider | null = null;
  onchange = null;
  onerror = null;
  onreadystatechange = null;
  readyState = "open" as const;
  startPosition = 0;
  endPosition = Infinity;
  vector: TimingStateVector = { position: 10, velocity: 1, acceleration: 0, timestamp: 100 };
  updates = 0;
  query(timestamp = performance.now() / 1_000) {
    return queryTimingStateVector(this.vector, timestamp);
  }
  nextChangeTimestamp(timestamp = performance.now() / 1_000) {
    return this.vector.timestamp > timestamp ? this.vector.timestamp : undefined;
  }
  async update() {
    this.updates++;
  }
}

describe("local audio timing", () => {
  let follower: AudioTimingObject | undefined;
  let clock: ReturnType<typeof spyOn> | undefined;
  afterEach(() => {
    follower?.dispose();
    clock?.mockRestore();
  });

  test("advances audio without mutating the source or visible timeline", () => {
    clock = spyOn(performance, "now").mockReturnValue(100_000);
    const source = new Source();
    follower = new AudioTimingObject(source, () => 0.1);
    expect(follower.query().position).toBeCloseTo(10.1);
    expect(follower.query().timestamp).toBe(100);
    expect(source.query().position).toBe(10);
  });
  test("queries through a future start instead of extrapolating the paused vector", () => {
    clock = spyOn(performance, "now").mockReturnValue(99_950);
    const source = new Source();
    follower = new AudioTimingObject(source, () => 0.1);
    expect(source.query().velocity).toBe(0);
    expect(follower.query().velocity).toBe(1);
    expect(follower.query().position).toBeCloseTo(10.05);
  });
  test("holds paused positions and applies authoritative seeks immediately", () => {
    clock = spyOn(performance, "now").mockReturnValue(100_000);
    const source = new Source();
    source.vector.velocity = 0;
    follower = new AudioTimingObject(source, () => 0.1);
    expect(follower.query().position).toBe(10);
    source.vector.position = 42;
    source.dispatchEvent(new Event("change"));
    expect(follower.query().position).toBe(42);
  });
  test("reflects device changes and playback speed", () => {
    clock = spyOn(performance, "now").mockReturnValue(100_000);
    const source = new Source();
    source.vector.velocity = 2;
    let delay = 0.1;
    follower = new AudioTimingObject(source, () => delay);
    expect(follower.query().position).toBeCloseTo(10.2);
    delay = 0.2;
    follower.refresh();
    expect(follower.query().position).toBeCloseTo(10.4);
  });
  test("forwards changes, then removes listeners on disposal", () => {
    const source = new Source();
    follower = new AudioTimingObject(source, () => 0);
    let changes = 0;
    follower.addEventListener("change", () => changes++);
    source.dispatchEvent(new Event("change"));
    expect(changes).toBe(1);
    follower.dispose();
    source.dispatchEvent(new Event("change"));
    expect(changes).toBe(1);
  });
  test("never forwards local updates to the provider", async () => {
    const source = new Source();
    follower = new AudioTimingObject(source, () => 0.1);
    await expect(follower.update()).rejects.toThrow("read-only");
    expect(source.updates).toBe(0);
  });

  test("wakes a paused follower before the scheduled start and cancels its timer", () => {
    clock = spyOn(performance, "now").mockReturnValue(99_000);
    const schedule = spyOn(globalThis, "setTimeout");
    const cancel = spyOn(globalThis, "clearTimeout");
    try {
      follower = new AudioTimingObject(new Source(), () => 0.1);
      expect(schedule.mock.calls.at(-1)?.[1]).toBeCloseTo(900);
      const timer = schedule.mock.results.at(-1)?.value;
      follower.dispose();
      expect(cancel).toHaveBeenCalledWith(timer);
    } finally {
      schedule.mockRestore();
      cancel.mockRestore();
    }
  });
});
