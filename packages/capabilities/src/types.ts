export type CapabilityValues<T> = T extends string
  ? T
  : T extends Record<string, unknown>
    ? CapabilityValues<T[keyof T]>
    : never;
