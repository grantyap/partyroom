import assert from "node:assert/strict";

// Pass a Playwright page on the local Vite server. Uses the real bundled worklet.
export async function checkTransposition(page) {
  const result = await page.evaluate(async () => {
    const { SoundTouchNode } = await import("/@id/@soundtouchjs/audio-worklet");
    const { default: processorUrl } =
      await import("/@id/@soundtouchjs/audio-worklet/processor?url");
    const { pitchProcessingDelay } =
      await import("/src/lib/synced-playback/internal/pitch-processing.ts");
    const measurements = [];
    for (const sampleRate of [44100, 48000]) {
      for (const semitones of [-6, -3, 3, 6]) {
        const context = new OfflineAudioContext(2, sampleRate * 3, sampleRate);
        await SoundTouchNode.register(context, processorUrl);
        const processor = new SoundTouchNode({ context });
        processor.pitchSemitones.value = semitones;
        const source = context.createBufferSource();
        const buffer = context.createBuffer(2, sampleRate * 3, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
          const data = buffer.getChannelData(channel);
          for (let frame = 0; frame < data.length; frame++) {
            const time = frame / sampleRate;
            const amplitude = time >= 1.5 && time < 1.7 ? 0.9 : 0.3;
            data[frame] = Math.sin(2 * Math.PI * 440 * time) * amplitude;
          }
        }
        source.buffer = buffer;
        source.connect(processor);
        processor.connect(context.destination);
        source.start();
        const rendered = await context.startRendering();
        const samples = rendered.getChannelData(0);
        const onset = samples.findIndex((value) => Math.abs(value) > 0.001) / sampleRate;
        let markerAt = -1;
        const window = Math.round(sampleRate * 0.01);
        for (let frame = sampleRate; frame < sampleRate * 2; frame += window) {
          let energy = 0;
          for (let i = frame; i < frame + window; i++) energy += samples[i] ** 2;
          if (Math.sqrt(energy / window) > 0.4) {
            markerAt = frame / sampleRate;
            break;
          }
        }
        let crossings = 0,
          energy = 0,
          finite = true;
        for (let frame = sampleRate; frame < sampleRate * 2; frame++) {
          if (samples[frame] > 0 && samples[frame - 1] <= 0) crossings++;
          energy += samples[frame] ** 2;
          finite &&= Number.isFinite(samples[frame]);
        }
        measurements.push({
          sampleRate,
          semitones,
          frequency: crossings,
          expected: 440 * 2 ** (semitones / 12),
          rms: Math.sqrt(energy / sampleRate),
          onset,
          markerAt,
          delay: pitchProcessingDelay(sampleRate, semitones),
          finite,
        });
        processor.disconnect();
        processor.port.close();
      }
    }
    return measurements;
  });
  for (const m of result) {
    assert(m.finite && m.rms > 0.1, `Silent or invalid audio: ${JSON.stringify(m)}`);
    assert(Math.abs(m.frequency - m.expected) < 5, `Wrong pitch: ${JSON.stringify(m)}`);
    assert(Math.abs(m.onset - m.delay) < 0.025, `Unexpected buffering: ${JSON.stringify(m)}`);
    assert(
      Math.abs(m.markerAt - m.delay - 1.5) < 0.05,
      `Tempo or alignment changed: ${JSON.stringify(m)}`,
    );
  }
  return result;
}
