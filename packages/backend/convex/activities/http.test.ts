import { describe, expect, test } from "vitest";
import { tokensEqual } from "./http";

describe("activity worker authentication", () => {
  test("compares worker bearer tokens without exposing their length", async () => {
    await expect(tokensEqual("same-secret", "same-secret")).resolves.toBe(true);
    await expect(tokensEqual("same-secret", "different-secret")).resolves.toBe(false);
    await expect(tokensEqual("short", "a-much-longer-token")).resolves.toBe(false);
  });
});
