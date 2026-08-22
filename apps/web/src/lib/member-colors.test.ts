import { describe, expect, test } from "bun:test";
import {
  getMemberColor,
  getMemberColorIndex,
  getMemberColors,
  MEMBER_COLOR_COUNT,
} from "./member-colors";

describe("member colors", () => {
  test("returns theme-aware semantic CSS variables", () => {
    const index = getMemberColorIndex("user-123");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(MEMBER_COLOR_COUNT);
    expect(getMemberColors("user-123")).toEqual({
      accent: `var(--member-accent-${index})`,
      fill: `var(--member-fill-${index})`,
      foreground: `var(--member-on-fill-${index})`,
    });
  });

  test("is deterministic across calls", () => {
    expect(getMemberColor("stable-user")).toBe(getMemberColor("stable-user"));
  });

  test("distributes representative IDs across the palette", () => {
    const colors = new Set(
      Array.from({ length: 100 }, (_, index) => getMemberColor(`user-${index}`)),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
