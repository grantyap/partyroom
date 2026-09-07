/**
 * Estimates the delay from Web Audio processing to device output, in seconds.
 * Returns zero when the context is not running or its output estimate is invalid.
 * Accepts each latency component only within 0–1 seconds to avoid large shifts
 * from unusable browser readings; an invalid base latency is ignored.
 */
export function audioOutputDelay(
  context: Pick<AudioContext, "state" | "baseLatency" | "outputLatency">,
) {
  if (context.state !== "running") return 0;
  const output = context.outputLatency;
  if (!Number.isFinite(output) || output < 0 || output > 1) return 0;
  const base = context.baseLatency;
  return output + (Number.isFinite(base) && base >= 0 && base <= 1 ? base : 0);
}
