import type { TimingStateVector } from "../types";

/**
 * Calculates playback state at a requested time, in seconds on the same clock
 * as vector.timestamp. Before the scheduled start, holds the position paused.
 * After that time, advances it using the speed and acceleration in the vector.
 *
 * Internal math helper. UI code should call OnlineTimingObject.query().
 * @see `$lib/timing` for the shared timeline API.
 */
export function queryTimingStateVector(vector: TimingStateVector, timestamp: number) {
  if (timestamp < vector.timestamp) {
    return {
      position: vector.position,
      velocity: 0,
      acceleration: 0,
      timestamp,
    } satisfies TimingStateVector;
  }
  const elapsed = timestamp - vector.timestamp;
  return {
    position: Math.max(
      0,
      vector.position + vector.velocity * elapsed + 0.5 * vector.acceleration * elapsed ** 2,
    ),
    velocity: vector.velocity + vector.acceleration * elapsed,
    acceleration: vector.acceleration,
    timestamp,
  } satisfies TimingStateVector;
}

/**
 * Converts a server timestamp to seconds on the browser's performance.now()
 * clock. providerTimeOrigin is the server time when that browser clock was zero.
 * The media position and speed stay unchanged.
 *
 * @see {@link queryTimingStateVector} for calculating playback from the result.
 */
export function translateProviderVector(
  vector: TimingStateVector,
  providerTimeOrigin: number,
): TimingStateVector {
  return { ...vector, timestamp: vector.timestamp - providerTimeOrigin };
}
