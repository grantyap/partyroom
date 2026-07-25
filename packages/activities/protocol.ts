/**
 * Compatibility version for the backend-to-worker HTTP protocol.
 *
 * Bump this when claim, lease, cancellation, progress, or artifact transport
 * changes incompatibly. Workflow graph changes do not require a bump; activity
 * input, output, or behavior changes require that activity's version to change.
 */
export const protocolVersion = 1 as const;
