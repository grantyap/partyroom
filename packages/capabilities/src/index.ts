import { rooms } from "./rooms";
import type { CapabilityValues } from "./types";

export * from "./rooms";

export const capabilities = { rooms } as const;

export type Capability = CapabilityValues<typeof capabilities>;
