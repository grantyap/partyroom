import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MediaAudioOutput } from "./media-audio-output";
import type { OnlineTimingObject } from "$lib/timing";

class Media extends EventTarget {
  static instances: Media[] = [];
  crossOrigin = "anonymous";
  preload = "";
  src = "";
  currentSrc = "";
  muted = false;
  volume = 0.5;
  paused = true;
  ended = false;
  readyState = 4;
  isConnected = true;
  constructor() {
    super();
    Media.instances.push(this);
  }
  load() {}
  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
  }
  pause() {
    this.paused = true;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}
class Node {
  gain = { value: 1 };
  connected = true;
  connect(_destination: unknown) {
    return this;
  }
  disconnect() {
    this.connected = false;
  }
}
class Context extends EventTarget {
  static instances: Context[] = [];
  state = "running";
  baseLatency = 0.01;
  get outputLatency() {
    return 0.1;
  }
  destination = {};
  sources: Media[] = [];
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
  createMediaElementSource(media: Media) {
    if (this.sources.includes(media)) throw new Error("duplicate source");
    this.sources.push(media);
    return new Node();
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
  query(timestamp = performance.now() / 1000) {
    return { position: 10, velocity: 1, acceleration: 0, timestamp };
  }
  nextChangeTimestamp() {
    return undefined;
  }
}

describe("media audio output routing", () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let output: MediaAudioOutput | undefined;
  let disconnects = 0;
  let connects = 0;
  const connect = () => {
    connects++;
    return () => {
      disconnects++;
    };
  };
  const create = (element: Media) =>
    MediaAudioOutput.create(
      element as unknown as HTMLMediaElement,
      new Timing() as unknown as OnlineTimingObject,
      connect,
    );
  beforeEach(() => {
    for (const [name, value] of Object.entries({
      Audio: Media,
      AudioContext: Context,
      location: { href: "https://party.test/", origin: "https://party.test" },
      navigator: {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 0,
      },
    })) {
      originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    }
    Media.instances = [];
    Context.instances = [];
    connects = 0;
    disconnects = 0;
  });
  afterEach(() => {
    output?.dispose();
    output = undefined;
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    originals.clear();
  });
  function setup() {
    const element = new Media();
    element.src = "https://party.test/song.mp4";
    output = create(element);
    expect(output).toBeDefined();
    const audio = Media.instances[1];
    const context = Context.instances[0];
    audio.dispatchEvent(new Event("loadedmetadata"));
    return { element, audio, context };
  }
  test("keeps the original audio until the compensated audio is playing", async () => {
    const { audio, context } = setup();
    expect(output!.active).toBe(false);
    await audio.play();
    expect(output!.active).toBe(true);
    expect(context.gains[1].gain.value).toBe(0);
    expect(context.gains[0].gain.value).toBe(0.5);
    expect(output!.delaySeconds).toBeCloseTo(0.11);
  });
  test("mirrors mute and volume without changing the visible element", async () => {
    const { element, audio, context } = setup();
    await audio.play();
    element.muted = true;
    element.dispatchEvent(new Event("volumechange"));
    expect(context.gains[0].gain.value).toBe(0);
    element.muted = false;
    element.volume = 0.2;
    element.dispatchEvent(new Event("volumechange"));
    expect(context.gains[0].gain.value).toBe(0.2);
    expect(element.muted).toBe(false);
  });
  test("falls back without double audio on a media failure", async () => {
    const { audio, context } = setup();
    await audio.play();
    audio.dispatchEvent(new Event("error"));
    expect(output!.active).toBe(false);
    expect(context.gains[0].gain.value).toBe(0);
    expect(context.gains[1].gain.value).toBe(1);
    expect(audio.paused).toBe(true);
    expect(disconnects).toBe(1);
  });
  test("stops the old audio immediately when the source is cleared", async () => {
    const { element, audio } = setup();
    await audio.play();
    element.dispatchEvent(new Event("emptied"));
    expect(audio.paused).toBe(true);
    expect(audio.src).toBe("");
    expect(output!.active).toBe(false);
    element.src = "https://party.test/next.mp4";
    element.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.src).toBe(element.src);
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(connects).toBe(2);
  });
  test("reuses the element graph across follower replacement and restores fallback on cleanup", () => {
    const { element, context } = setup();
    output!.dispose();
    output = create(element);
    expect(output).toBeDefined();
    expect(Context.instances.length).toBe(1);
    expect(context.sources.filter((source) => source === element).length).toBe(1);
    output!.dispose();
    expect(context.gains[1].gain.value).toBe(1);
  });
  test("does not attach a graph to non-CORS cross-origin media", () => {
    const element = new Media();
    element.crossOrigin = "";
    element.src = "https://other.test/song.mp4";
    output = create(element);
    expect(output).toBeUndefined();
    expect(Context.instances.length).toBe(0);
  });
  test("uses the original playback path when AudioContext is unavailable", () => {
    Reflect.deleteProperty(globalThis, "AudioContext");
    output = create(new Media());
    expect(output).toBeUndefined();
  });

  test.each([
    [
      "iPhone Safari",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Safari/605.1.15",
      "iPhone",
      5,
    ],
    ["iPad Safari", "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) Safari/605.1.15", "iPad", 5],
    [
      "iPad desktop mode",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15",
      "MacIntel",
      5,
    ],
    [
      "iOS Chrome",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) CriOS/140.0 Mobile Safari/604.1",
      "iPhone",
      5,
    ],
  ])("keeps a single native media element on %s", (_name, userAgent, platform, maxTouchPoints) => {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent, platform, maxTouchPoints },
      configurable: true,
    });
    const element = new Media();
    element.src = "https://party.test/song.mp4";
    output = create(element);
    expect(output).toBeUndefined();
    expect(Media.instances).toHaveLength(1);
    expect(Context.instances).toHaveLength(0);
    expect(connects).toBe(0);
  });

  test("requests a gesture when the context suspends and restores audio after resume", async () => {
    const { context, audio } = setup();
    await audio.play();
    context.state = "suspended";
    context.dispatchEvent(new Event("statechange"));
    expect(output!.needsUserGesture).toBe(true);
    expect(output!.delaySeconds).toBe(0);
    await output!.resume();
    expect(output!.needsUserGesture).toBe(false);
    expect(output!.active).toBe(true);
  });
});
