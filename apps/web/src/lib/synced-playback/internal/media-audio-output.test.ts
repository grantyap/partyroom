import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { OnlineTimingObject } from "#lib/timing/index.js";
import { queryTimingStateVector } from "#lib/timing/internal/state-vector.js";

class Node extends EventTarget {
  gain = { value: 1 };
  destinations: unknown[] = [];
  connect(destination: unknown) {
    this.destinations.push(destination);
    return destination;
  }
  disconnect() {
    this.destinations = [];
  }
}
class Source extends Node {
  buffer: unknown;
  offset = 0;
  stopped = false;
  start(_time: number, offset: number) {
    this.offset = offset;
  }
  stop() {
    this.stopped = true;
  }
}
class Processor extends Node {
  static instances: Processor[] = [];
  pitchSemitones = { value: 0 };
  port = { close() {} };
  constructor(_options: unknown) {
    super();
    Processor.instances.push(this);
  }
  static async register(_context: unknown, _url: unknown) {}
}
mock.module("@soundtouchjs/audio-worklet/processor?url", () => ({ default: "/processor.js" }));
mock.module("@soundtouchjs/audio-worklet", () => ({ SoundTouchNode: Processor }));
const { MediaAudioOutput } = await import("./media-audio-output");

class Media extends EventTarget {
  volume = 0.5;
  muted = false;
}
class Context extends EventTarget {
  static instances: Context[] = [];
  state = "running";
  baseLatency = 0.01;
  outputLatency = 0.1;
  sampleRate = 48000;
  currentTime = 0;
  destination = {};
  sources: Source[] = [];
  gains: Node[] = [];
  constructor() {
    super();
    Context.instances.push(this);
  }
  createGain() {
    const node = new Node();
    this.gains.push(node);
    return node;
  }
  createBufferSource() {
    const source = new Source();
    this.sources.push(source);
    return source;
  }
  async decodeAudioData(_data: unknown) {
    return { duration: 180 };
  }
  async resume() {
    this.state = "running";
    this.dispatchEvent(new Event("statechange"));
  }
  async close() {
    this.state = "closed";
  }
}
class Timing extends EventTarget {
  readyState = "open";
  startPosition = 0;
  endPosition = Infinity;
  vector = { position: 10, velocity: 1, acceleration: 0, timestamp: 100 };
  query(timestamp = performance.now() / 1000) {
    return queryTimingStateVector(this.vector, timestamp);
  }
  nextChangeTimestamp(timestamp = performance.now() / 1000) {
    return this.vector.timestamp > timestamp ? this.vector.timestamp : undefined;
  }
  change(position: number, velocity: number) {
    this.vector = { position, velocity, acceleration: 0, timestamp: performance.now() / 1000 };
    this.dispatchEvent(new Event("change"));
  }
}

describe("buffered stem playback", () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let output: ReturnType<typeof MediaAudioOutput.create>;
  let fetchMock: ReturnType<typeof spyOn>;
  let clock: ReturnType<typeof spyOn>;
  beforeEach(() => {
    for (const [name, value] of Object.entries({
      AudioContext: Context,
      AudioWorkletNode: Node,
      isSecureContext: true,
    })) {
      originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { value, configurable: true });
    }
    clock = spyOn(performance, "now").mockReturnValue(100000);
    fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ArrayBuffer(16)));
    Context.instances = [];
    Processor.instances = [];
  });
  afterEach(() => {
    output?.dispose();
    output = undefined;
    fetchMock.mockRestore();
    clock.mockRestore();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    originals.clear();
  });
  function create(element: Media, timing = new Timing()) {
    output = MediaAudioOutput.create(
      element as unknown as HTMLMediaElement,
      timing as unknown as OnlineTimingObject,
      "https://party.test/instrumental.flac",
    );
    return output!;
  }
  async function setup() {
    const element = new Media();
    const timing = new Timing();
    create(element, timing);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { element, timing, context: Context.instances[0] };
  }

  test("mutes video and schedules the instrumental ahead of device output latency", async () => {
    const { element, context } = await setup();
    expect(output!.ready).toBe(true);
    expect(element.muted).toBe(true);
    expect(context.sources.at(-1)!.offset).toBeCloseTo(10.11);
    expect(context.gains[0].gain.value).toBe(0.5);
    expect(Processor.instances).toHaveLength(0);
  });
  test("changes pitch without changing transport and restores the direct path on reset", async () => {
    const { timing, context } = await setup();
    const first = context.sources.at(-1)!;
    const vector = { ...timing.vector };
    output!.setSemitones(-3);
    expect(first.stopped).toBe(true);
    expect(Processor.instances.at(-1)!.pitchSemitones.value).toBe(-3);
    expect(context.sources.at(-1)!.offset).toBeGreaterThan(10.11);
    expect(timing.vector).toEqual(vector);
    output!.setSemitones(0);
    expect(context.sources.at(-1)!.offset).toBeCloseTo(10.11);
    expect(context.gains[1].destinations).toEqual([context.gains[0]]);
  });
  test("applies local mute and volume to the mix while keeping video muted", async () => {
    const { element, context } = await setup();
    output!.toggleMuted();
    expect(context.gains[0].gain.value).toBe(0);
    output!.toggleMuted();
    element.volume = 0.2;
    element.dispatchEvent(new Event("volumechange"));
    expect(context.gains[0].gain.value).toBe(0.2);
    expect(element.muted).toBe(true);
    output!.dispose();
    expect(element.muted).toBe(false);
  });
  test("discards old audio on seek and pause, then creates a fresh source on resume", async () => {
    const { timing, context } = await setup();
    output!.setSemitones(2);
    const source = context.sources.at(-1)!;
    timing.change(42, 1);
    expect(source.stopped).toBe(true);
    expect(context.sources.at(-1)!.offset).toBeGreaterThan(42);
    const seeking = context.sources.at(-1)!;
    timing.change(42, 0);
    expect(seeking.stopped).toBe(true);
    const count = context.sources.length;
    timing.change(42, 1);
    expect(context.sources).toHaveLength(count + 1);
    expect(Processor.instances).toHaveLength(3);
  });
  test("keeps the same source when video drift does not change the audio timeline", async () => {
    const { timing, context } = await setup();
    context.currentTime += 1;
    clock.mockReturnValue(101000);
    timing.dispatchEvent(new Event("change"));
    expect(context.sources).toHaveLength(1);
  });
  test("requests a user gesture after interruption and resumes from the shared position", async () => {
    const { context } = await setup();
    context.state = "suspended";
    context.dispatchEvent(new Event("statechange"));
    expect(output!.needsUserGesture).toBe(true);
    expect(context.sources[0].stopped).toBe(true);
    await output!.resume();
    expect(output!.needsUserGesture).toBe(false);
    expect(context.sources).toHaveLength(2);
  });
  test("restores native original-key playback on processor failure", async () => {
    const { element, context } = await setup();
    output!.setSemitones(3);
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      Processor.instances.at(-1)!.dispatchEvent(new Event("processorerror"));
      expect(output!.ready).toBe(false);
      expect(output!.error).toContain("original key");
      expect(element.muted).toBe(false);
      expect(context.state).toBe("closed");
      expect(context.sources.at(-1)!.stopped).toBe(true);
      await expect(output!.resume()).resolves.toBeUndefined();
    } finally {
      warning.mockRestore();
    }
  });
  test("keeps native playback on a download failure", async () => {
    fetchMock.mockResolvedValue(new Response("missing", { status: 404 }));
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { element } = await setup();
      expect(output!.error).toContain("original key");
      expect(element.muted).toBe(false);
    } finally {
      warning.mockRestore();
    }
  });
  test("does not acquire media resources when Web Audio is unavailable", () => {
    Reflect.deleteProperty(globalThis, "AudioContext");
    expect(create(new Media())).toBeUndefined();
    expect(MediaAudioOutput.unavailableReason).toContain("not supported by this browser");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("rejects insecure LAN origins even when AudioWorkletNode exists", () => {
    Object.defineProperty(globalThis, "isSecureContext", { value: false, configurable: true });
    const element = new Media();
    expect(create(element)).toBeUndefined();
    expect(MediaAudioOutput.unavailableReason).toContain("requires HTTPS or localhost");
    expect(Context.instances).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(element.muted).toBe(false);
  });
  test("aborts pending loads and never mutes the video after disposal", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const element = new Media();
    create(element);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    output!.dispose();
    expect(signal.aborted).toBe(true);
    resolve(new Response(new ArrayBuffer(16)));
    await new Promise((done) => setTimeout(done, 0));
    expect(element.muted).toBe(false);
    expect(Context.instances[0].sources).toHaveLength(0);
  });
  test("does not truncate the processor tail at the end of a song", async () => {
    const { timing, context } = await setup();
    output!.setSemitones(-2);
    const source = context.sources.at(-1)!;
    context.currentTime = 169.99;
    clock.mockReturnValue(269990);
    timing.dispatchEvent(new Event("change"));
    expect(source.stopped).toBe(false);
  });
  test("discards old audio when seeking into the final buffered tail", async () => {
    const { timing, context } = await setup();
    output!.setSemitones(-2);
    const source = context.sources.at(-1)!;
    timing.change(179.99, 1);
    expect(source.stopped).toBe(true);
  });
});
