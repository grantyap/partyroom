import type { SoundTouchNode } from "@soundtouchjs/audio-worklet";
import processorUrl from "@soundtouchjs/audio-worklet/processor?url";
import type { OnlineTimingObject } from "#lib/timing/index.js";
import { audioOutputDelay } from "./audio-output-latency";
import { AudioTimingObject } from "./audio-timing-object";
import { pitchProcessingDelay } from "./pitch-processing";

/** Owns stem decoding, audio scheduling, and effects; the video supplies only the picture. */
export class MediaAudioOutput {
  readonly #context: AudioContext;
  readonly #master: GainNode;
  readonly #mix: GainNode;
  readonly #timing: AudioTimingObject;
  readonly #abort = new AbortController();
  #muted: boolean;
  readonly #timer: ReturnType<typeof setInterval>;
  #buffer: AudioBuffer | undefined;
  #source: AudioBufferSourceNode | undefined;
  #processor: SoundTouchNode | undefined;
  #nodeType: typeof SoundTouchNode | undefined;
  #startedAt = 0;
  #position = 0;
  #semitones = 0;
  #delay = 0;
  #disposed = false;
  #error: string | null = null;

  static get unavailableReason() {
    if (globalThis.isSecureContext === false)
      return "Transposition requires HTTPS or localhost. Playing the original key.";
    if (typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined")
      return "Transposition is not supported by this browser. Playing the original key.";
    return null;
  }

  static create(
    element: HTMLMediaElement,
    timing: OnlineTimingObject,
    instrumentalUrl: string,
    alignmentToleranceSeconds = 0.025,
  ) {
    if (this.unavailableReason) return;
    try {
      return new MediaAudioOutput(element, timing, instrumentalUrl, alignmentToleranceSeconds);
    } catch (cause) {
      console.warn("Stem playback unavailable", cause);
      return;
    }
  }

  private constructor(
    readonly element: HTMLMediaElement,
    timing: OnlineTimingObject,
    instrumentalUrl: string,
    readonly alignmentToleranceSeconds: number,
  ) {
    this.#muted = element.muted;
    this.#context = new AudioContext({ latencyHint: "interactive" });
    this.#master = this.#context.createGain();
    this.#master.connect(this.#context.destination);
    // A future vocal source connects through its own gain to this shared mix input.
    this.#mix = this.#context.createGain();
    this.#mix.connect(this.#master);
    this.#timing = new AudioTimingObject(timing, () => this.#delay);
    this.#timing.addEventListener("change", this.#refresh);
    this.#context.addEventListener("statechange", this.#refresh);
    this.#context.addEventListener("sinkchange", this.#refresh);
    element.addEventListener("volumechange", this.#volume);
    this.#timer = setInterval(this.#refresh, 250);
    this.#volume();
    void this.#context.resume().catch(() => {});
    void this.#load(instrumentalUrl);
  }

  get ready() {
    return Boolean(this.#buffer && this.#nodeType && !this.#error && !this.#disposed);
  }
  get active() {
    return this.ready && this.#context.state === "running";
  }
  get error() {
    return this.#error;
  }
  get delaySeconds() {
    return this.#delay;
  }
  get needsUserGesture() {
    return !this.#error && this.#context.state !== "running";
  }

  setSemitones(semitones: number) {
    if (!Number.isInteger(semitones) || semitones < -6 || semitones > 6)
      throw new Error("Transposition must be a whole number from -6 to 6 semitones");
    if (this.#semitones === semitones) return;
    this.#semitones = semitones;
    // Recreate the processor to discard old buffered audio and recompute its delay.
    this.#stop();
    this.#refresh();
  }

  resume() {
    if (this.#error || this.#disposed) return Promise.resolve();
    return this.#context.resume().then(() => {
      if (this.#context.state !== "running") throw new Error("Audio playback is blocked");
      this.#refresh();
    });
  }

  toggleMuted() {
    this.#muted = !this.#muted;
    this.#volume();
  }

  async #load(url: string) {
    try {
      const [buffer, nodeType] = await Promise.all([
        fetch(url, { signal: this.#abort.signal }).then(async (response) => {
          if (!response.ok) throw new Error(`Instrumental download failed: ${response.status}`);
          // ponytail: keep one decoded stem; use streaming if long songs exceed mobile memory.
          return await this.#context.decodeAudioData(await response.arrayBuffer());
        }),
        import("@soundtouchjs/audio-worklet").then(async ({ SoundTouchNode }) => {
          await SoundTouchNode.register(this.#context, processorUrl);
          return SoundTouchNode;
        }),
      ]);
      if (this.#disposed) return;
      this.#buffer = buffer;
      this.#nodeType = nodeType;
      this.element.muted = true;
      this.#refresh();
    } catch (cause) {
      if (!this.#disposed) this.#fail(cause);
    }
  }

  readonly #volume = () => {
    if (!this.ready) this.#muted = this.element.muted;
    this.#master.gain.value = this.#muted ? 0 : this.element.volume;
    if (this.ready && !this.element.muted) this.element.muted = true;
  };

  readonly #refresh = () => {
    if (!this.ready) return;
    try {
      const delay = this.active
        ? audioOutputDelay(this.#context) +
          pitchProcessingDelay(this.#context.sampleRate, this.#semitones)
        : 0;
      if (Math.abs(delay - this.#delay) > 0.001) {
        this.#delay = delay;
        this.#timing.refresh();
      }
      const vector = this.#timing.query();
      if (!this.active || vector.velocity === 0) {
        this.#stop();
        return;
      }
      const position = this.#position + this.#context.currentTime - this.#startedAt;
      const aligned =
        this.#source && Math.abs(position - vector.position) <= this.alignmentToleranceSeconds;
      // Drain a naturally ending source, but discard old audio after a seek past its end.
      if (vector.position >= this.#buffer!.duration) {
        if (!aligned) this.#stop();
        return;
      }
      if (aligned) return;
      this.#stop();
      const source = this.#context.createBufferSource();
      source.buffer = this.#buffer!;
      if (this.#semitones !== 0) {
        const processor = new this.#nodeType!({ context: this.#context });
        processor.pitchSemitones.value = this.#semitones;
        processor.addEventListener("processorerror", this.#processorError);
        this.#mix.disconnect();
        this.#mix.connect(processor);
        processor.connect(this.#master);
        this.#processor = processor;
      }
      source.connect(this.#mix);
      this.#source = source;
      this.#startedAt = this.#context.currentTime;
      this.#position = Math.max(0, vector.position);
      source.start(0, this.#position);
    } catch (cause) {
      this.#fail(cause);
    }
  };

  #stop() {
    this.#source?.stop();
    this.#source?.disconnect();
    this.#source = undefined;
    if (this.#processor) {
      this.#mix.disconnect();
      this.#processor.removeEventListener("processorerror", this.#processorError);
      this.#processor.disconnect();
      this.#processor.port.close();
      this.#processor = undefined;
      this.#mix.connect(this.#master);
    }
  }

  readonly #processorError = () => this.#fail(new Error("Pitch processor failed"));

  #fail(cause: unknown) {
    this.#error = "Transposition unavailable. Playing the original key.";
    this.#stop();
    this.#buffer = undefined;
    this.#delay = 0;
    this.element.muted = this.#muted;
    console.warn("Stem playback unavailable", cause);
    void this.#context.close().catch(() => {});
  }

  readonly dispose = () => {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#abort.abort();
    clearInterval(this.#timer);
    this.#timing.removeEventListener("change", this.#refresh);
    this.#timing.dispose();
    this.#context.removeEventListener("statechange", this.#refresh);
    this.#context.removeEventListener("sinkchange", this.#refresh);
    this.element.removeEventListener("volumechange", this.#volume);
    this.#stop();
    this.#buffer = undefined;
    this.#mix.disconnect();
    this.#master.disconnect();
    this.element.muted = this.#muted;
    void this.#context.close().catch(() => {});
  };
}
