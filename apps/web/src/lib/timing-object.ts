/**
 * The W3C Timing Object state vector. Position is measured in media seconds;
 * timestamp is measured in seconds on the clock domain that owns the vector.
 *
 * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#state-vector
 */
export type TimingStateVector = {
  position: number;
  velocity: number;
  acceleration: number;
  timestamp: number;
};

/** Components accepted by a Timing Object update operation. */
export type TimingStateVectorUpdate = Partial<
  Pick<TimingStateVector, "position" | "velocity" | "acceleration">
>;

/** A provider vector paired with its monotonically increasing change revision. */
export type ProviderTimingState = {
  vector: TimingStateVector;
  revision: number;
};

/**
 * Evaluates constant-acceleration motion at `timestamp`, returning a new vector
 * whose position, velocity, and timestamp are valid at that exact instant.
 *
 * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#process-a-query-operation
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
 * Translates a provider vector timestamp to the user agent's monotonic clock.
 * `providerTimeOrigin` is the provider timestamp corresponding to local time 0.
 *
 * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#translate-timestamp-from-timing-resource-provider-to-user-agent-timeline
 */
export function translateProviderVector(
  vector: TimingStateVector,
  providerTimeOrigin: number,
): TimingStateVector {
  return { ...vector, timestamp: vector.timestamp - providerTimeOrigin };
}
