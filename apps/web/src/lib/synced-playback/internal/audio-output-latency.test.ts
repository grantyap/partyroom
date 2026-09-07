import { describe, expect, test } from "bun:test";
import { audioOutputDelay } from "./audio-output-latency";

describe("audio output delay", () => {
  test("includes graph and device latency exactly once", () => {
    expect(
      audioOutputDelay({ state: "running", baseLatency: 0.01, outputLatency: 0.1 }),
    ).toBeCloseTo(0.11);
  });
  test("does not advance a suspended or closed context", () => {
    for (const state of ["suspended", "closed"] as const) {
      expect(audioOutputDelay({ state, baseLatency: 0.01, outputLatency: 0.1 })).toBe(0);
    }
  });
  test("rejects invalid or unavailable output estimates", () => {
    for (const outputLatency of [NaN, Infinity, -1, 2, undefined as unknown as number]) {
      expect(audioOutputDelay({ state: "running", baseLatency: 0.01, outputLatency })).toBe(0);
    }
  });
  test("accepts zero output latency and ignores invalid base latency", () => {
    expect(audioOutputDelay({ state: "running", baseLatency: 0.01, outputLatency: 0 })).toBe(0.01);
    expect(audioOutputDelay({ state: "running", baseLatency: NaN, outputLatency: 0.1 })).toBe(0.1);
  });
});
