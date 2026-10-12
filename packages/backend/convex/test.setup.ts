/// <reference types="vite/client" />

export const modules = import.meta.glob("./**/*.{ts,js}");

import type { convexTest } from "convex-test";
import stripeSchema from "../../../node_modules/@convex-dev/stripe/src/component/schema";
const stripeModules = import.meta.glob(
  "../../../node_modules/@convex-dev/stripe/src/component/**/*.{ts,js}",
);
export function registerStripe(t: ReturnType<typeof convexTest>) {
  t.registerComponent("stripe", stripeSchema, stripeModules);
}
