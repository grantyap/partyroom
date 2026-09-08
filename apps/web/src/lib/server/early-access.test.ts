import { describe, expect, test } from "bun:test";
import { createEarlyAccessToken, EARLY_ACCESS_MAX_AGE, hasEarlyAccess } from "./early-access";

describe("early access cookie", () => {
  test("accepts only unexpired tokens signed with the server secret", () => {
    const now = Date.UTC(2026, 8, 8);
    const token = createEarlyAccessToken("secret", now);

    expect(hasEarlyAccess(token, "secret", now)).toBe(true);
    expect(hasEarlyAccess(token, "wrong", now)).toBe(false);
    expect(hasEarlyAccess(token, "secret", now + (EARLY_ACCESS_MAX_AGE + 1) * 1000)).toBe(false);
  });
});
