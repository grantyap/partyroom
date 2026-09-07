/**
 * Playback state at a particular time. The Timing Object specification calls
 * this a "state vector". It lets a client calculate a later playback position
 * from the position, speed, and elapsed time.
 *
 * @see https://www.w3.org/community/reports/webtiming/CG-FINAL-timingobject-20241203/#state-vector
 */
export type TimingStateVector = {
  /** Position in the media, in seconds. */
  position: number;
  /** Playback speed: 1 is normal speed, 0 is paused. */
  velocity: number;
  /** Change in playback speed per second; normally 0. */
  acceleration: number;
  /**
   * Time when this state applies, in seconds. Server state uses the server clock;
   * OnlineTimingObject.query() returns browser performance.now() time in seconds.
   */
  timestamp: number;
};

/**
 * Fields that can be changed in a playback request. Omitted fields keep their
 * current values; the timeline chooses when the change takes effect.
 */
export type TimingStateVectorUpdate = Partial<
  Pick<TimingStateVector, "position" | "velocity" | "acceleration">
>;

/**
 * Playback state received from the server. The revision increases with each
 * server change so clients can tell whether a response includes their update.
 */
export type ProviderTimingState = {
  vector: TimingStateVector;
  revision: number;
};
