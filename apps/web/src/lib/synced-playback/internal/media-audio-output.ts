import type { ITimingObject } from "timing-object";
import { audioOutputDelay } from "./audio-output-latency";
import { AudioTimingObject } from "./audio-timing-object";
import type { OnlineTimingObject } from "$lib/timing";

type AudioGraph = {
  context: AudioContext;
  originalGain: GainNode;
  release?: () => void;
};
// A media element can only be bound to one MediaElementAudioSourceNode, including
// across HMR and timing reconnections. Keep its original graph on the element.
const graphKey = Symbol.for("partyroom.audio-output.graph");
type RoutedMediaElement = HTMLMediaElement & { [graphKey]?: AudioGraph };
type Connect = (element: HTMLMediaElement, timing: ITimingObject) => () => void;

export class MediaAudioOutput {
  readonly #element: RoutedMediaElement;
  readonly #audio: HTMLAudioElement;
  readonly #graph: AudioGraph;
  readonly #audioSource: MediaElementAudioSourceNode;
  readonly #gain: GainNode;
  readonly #timing: AudioTimingObject;
  readonly #connect: Connect;
  #disconnect: (() => void) | undefined;
  #timer: ReturnType<typeof setInterval>;
  #failed = false;
  #disposed = false;
  #delay = 0;

  static create(element: HTMLMediaElement, timing: OnlineTimingObject, connect: Connect) {
    // iOS can interrupt one audible media element when another starts. A zero
    // Web Audio gain does not mute the underlying element for that policy, so
    // the two followers can repeatedly pause each other and reopen the join UI.
    // Keep native, single-element playback on iPhone and iPad (including iPad's
    // desktop user agent), before attaching an irreversible Web Audio graph.
    if (
      typeof navigator !== "undefined" &&
      (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))
    )
      return;
    if (typeof AudioContext === "undefined" || !("outputLatency" in AudioContext.prototype)) return;
    // Web Audio silences non-CORS cross-origin media. Retain native playback in
    // that case; never attach an irreversible source node to a tainted element.
    if (
      !element.crossOrigin &&
      new URL(element.currentSrc || element.src, location.href).origin !== location.origin
    )
      return;
    try {
      return new MediaAudioOutput(element, timing, connect);
    } catch (cause) {
      console.warn("Audio output compensation unavailable", cause);
      return;
    }
  }

  private constructor(element: RoutedMediaElement, timing: OnlineTimingObject, connect: Connect) {
    this.#element = element;
    this.#connect = connect;
    element[graphKey]?.release?.();
    const context = element[graphKey]?.context ?? new AudioContext({ latencyHint: "interactive" });
    const audio = new Audio();
    audio.crossOrigin = element.crossOrigin || "anonymous";
    audio.preload = "auto";
    this.#audio = audio;
    this.#gain = context.createGain();
    this.#gain.gain.value = 0;
    this.#gain.connect(context.destination);
    this.#audioSource = context.createMediaElementSource(audio);
    this.#audioSource.connect(this.#gain);
    if (!element[graphKey]) {
      const originalGain = context.createGain();
      originalGain.connect(context.destination);
      try {
        context.createMediaElementSource(element).connect(originalGain);
      } catch (cause) {
        this.#audioSource.disconnect();
        this.#gain.disconnect();
        originalGain.disconnect();
        void context.close().catch(() => {});
        throw cause;
      }
      element[graphKey] = { context, originalGain };
    }
    this.#graph = element[graphKey];
    this.#graph.release = this.dispose;
    this.#timing = new AudioTimingObject(timing, () => this.#delay);
    element.addEventListener("loadstart", this.#load);
    element.addEventListener("emptied", this.#reset);
    element.addEventListener("loadedmetadata", this.#load);
    element.addEventListener("volumechange", this.#volume);
    audio.addEventListener("loadedmetadata", this.#reconnect);
    audio.addEventListener("playing", this.#route);
    audio.addEventListener("waiting", this.#fallback);
    audio.addEventListener("error", this.#fail);
    context.addEventListener("statechange", this.#refresh);
    context.addEventListener("sinkchange", this.#refresh);
    this.#timer = setInterval(this.#refresh, 250);
    this.#load();
    this.#refresh();
    void context.resume().catch(() => {});
  }

  get delaySeconds() {
    return this.#delay;
  }
  get active() {
    return this.#graph.originalGain.gain.value === 0 && !this.#disposed;
  }
  get needsUserGesture() {
    return (
      this.#graph.context.state !== "running" ||
      (!this.#failed &&
        this.#timing.query().velocity !== 0 &&
        this.#audio.paused &&
        !this.#audio.ended)
    );
  }

  /**
   * Resumes the audio context and, when the room is playing, the audio element.
   * Call directly from a user interaction so browser autoplay rules allow it.
   * Both operations begin before the returned promise waits for their results.
   */
  resume() {
    const contextResume = this.#graph.context.resume();
    const audioPlay =
      !this.#failed && this.#timing.query().velocity !== 0 ? this.#audio.play() : Promise.resolve();
    return Promise.all([contextResume, audioPlay]).then(() => this.#refresh());
  }

  readonly #volume = () => {
    // Use graph gain so volume works on platforms with read-only media volume.
    this.#gain.gain.value = this.active && !this.#element.muted ? this.#element.volume : 0;
  };

  readonly #fallback = () => {
    this.#graph.originalGain.gain.value = 1;
    this.#gain.gain.value = 0;
  };

  readonly #route = () => {
    if (this.#disposed || this.#failed || this.#graph.context.state !== "running") return;
    this.#graph.originalGain.gain.value = 0;
    this.#volume();
  };

  readonly #fail = () => {
    this.#failed = true;
    this.#disconnect?.();
    this.#disconnect = undefined;
    this.#audio.pause();
    this.#fallback();
  };

  readonly #load = () => {
    const src = this.#element.currentSrc || this.#element.src;
    if (!src || src === this.#audio.src) return;
    this.#disconnect?.();
    this.#disconnect = undefined;
    this.#failed = false;
    this.#fallback();
    this.#audio.src = src;
    this.#audio.load();
  };

  readonly #reset = () => {
    this.#disconnect?.();
    this.#disconnect = undefined;
    this.#audio.pause();
    this.#audio.removeAttribute("src");
    this.#audio.load();
    this.#fallback();
  };

  readonly #reconnect = () => {
    this.#disconnect?.();
    this.#disconnect = this.#connect(this.#audio, this.#timing);
  };

  readonly #refresh = () => {
    if (this.#disposed) return;
    const delay = audioOutputDelay(this.#graph.context);
    if (Math.abs(delay - this.#delay) > 0.001) {
      this.#delay = delay;
      this.#timing.refresh();
    }
    if (this.#graph.context.state !== "running") this.#fallback();
    else if (!this.#audio.paused && this.#audio.readyState >= 3) this.#route();
  };

  readonly dispose = () => {
    if (this.#disposed) return;
    this.#disposed = true;
    clearInterval(this.#timer);
    this.#disconnect?.();
    this.#timing.dispose();
    this.#fallback();
    this.#element.removeEventListener("loadstart", this.#load);
    this.#element.removeEventListener("emptied", this.#reset);
    this.#element.removeEventListener("loadedmetadata", this.#load);
    this.#element.removeEventListener("volumechange", this.#volume);
    this.#audio.removeEventListener("loadedmetadata", this.#reconnect);
    this.#audio.removeEventListener("playing", this.#route);
    this.#audio.removeEventListener("waiting", this.#fallback);
    this.#audio.removeEventListener("error", this.#fail);
    this.#graph.context.removeEventListener("statechange", this.#refresh);
    this.#graph.context.removeEventListener("sinkchange", this.#refresh);
    this.#audio.pause();
    this.#audio.removeAttribute("src");
    this.#audio.load();
    this.#audioSource.disconnect();
    this.#gain.disconnect();
    this.#graph.release = undefined;
    // Reconnection/HMR reuses the graph. Once the element leaves the DOM, release
    // the hardware too. Never close a graph that a new follower has acquired.
    setTimeout(() => {
      if (!this.#element.isConnected && !this.#graph.release) {
        void this.#graph.context.close().catch(() => {});
      }
    }, 0);
  };
}
