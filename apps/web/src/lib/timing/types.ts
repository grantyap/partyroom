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
