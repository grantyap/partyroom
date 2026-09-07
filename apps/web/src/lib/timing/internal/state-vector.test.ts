import { describe, expect, test } from "bun:test";
import { queryTimingStateVector, translateProviderVector } from "./state-vector";

describe("W3C timing state vectors", () => {
  test("queries position and velocity at one monotonic timestamp", () => {
    expect(
      queryTimingStateVector({ position: 5, velocity: 2, acceleration: 0.5, timestamp: 10 }, 14),
    ).toEqual({ position: 17, velocity: 4, acceleration: 0.5, timestamp: 14 });
  });

  test("keeps a paused vector fixed while updating its query timestamp", () => {
    expect(
      queryTimingStateVector({ position: 42, velocity: 0, acceleration: 0, timestamp: 10 }, 50),
    ).toEqual({ position: 42, velocity: 0, acceleration: 0, timestamp: 50 });
  });

  test("holds a future-dated vector until its provider start instant", () => {
    expect(
      queryTimingStateVector({ position: 42, velocity: 1, acceleration: 0, timestamp: 50 }, 49),
    ).toEqual({ position: 42, velocity: 0, acceleration: 0, timestamp: 49 });
  });

  test("translates provider timestamps without changing motion", () => {
    expect(
      translateProviderVector(
        { position: 12, velocity: 1, acceleration: 0, timestamp: 1_010 },
        1_000,
      ),
    ).toEqual({ position: 12, velocity: 1, acceleration: 0, timestamp: 10 });
  });
});
