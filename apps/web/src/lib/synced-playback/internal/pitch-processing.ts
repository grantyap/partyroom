import { SoundTouch } from "@soundtouchjs/core";

const delays = new Map<string, number>();

/** Estimates buffering using the same engine and 128-frame blocks as the worklet. */
export function pitchProcessingDelay(sampleRate: number, semitones: number) {
  if (semitones === 0) return 0;
  const key = `${sampleRate}:${semitones}`;
  const cached = delays.get(key);
  if (cached !== undefined) return cached;
  const pipe = new SoundTouch({ sampleRate });
  pipe.pitchSemitones = semitones;
  const silence = new Float32Array(256);
  let missing = 0;
  for (let frame = 0; frame < sampleRate / 2; frame += 128) {
    pipe.inputBuffer.putSamples(silence, 0, 128);
    pipe.process();
    const available = Math.min(128, pipe.outputBuffer.frameCount);
    missing += 128 - available;
    pipe.outputBuffer.receive(available);
  }
  const delay = missing / sampleRate;
  delays.set(key, delay);
  return delay;
}
