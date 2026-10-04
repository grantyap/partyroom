import { afterEach, expect, test, vi } from "vitest";
import { createAuth } from "./auth";

afterEach(() => vi.unstubAllEnvs());

test("LAN development trusts only the configured additional origin", () => {
  vi.stubEnv("DEV_SITE_URL", "https://pmm.local");
  const auth = createAuth({} as Parameters<typeof createAuth>[0]);
  expect(auth.options.trustedOrigins).toEqual([
    "https://pmm.local",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
});

test("ordinary development and production add no extra trusted origins", () => {
  vi.stubEnv("DEV_SITE_URL", undefined);
  const auth = createAuth({} as Parameters<typeof createAuth>[0]);
  expect(auth.options.trustedOrigins).toEqual([]);
});
