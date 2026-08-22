import { describe, expect, test } from "bun:test";
import { createUuidInAnyContext } from "./context-uuid";

describe("createUuidInAnyContext", () => {
  test("uses randomUUID when the browser provides it", () => {
    const expected = "10000000-1000-4000-8000-100000000000";
    const source = {
      randomUUID: () => expected,
      getRandomValues: <T extends ArrayBufferView | null>(array: T) => array,
    };

    expect(createUuidInAnyContext(source)).toBe(expected);
  });

  test("falls back to getRandomValues when randomUUID is unavailable", () => {
    const source = {
      getRandomValues: <T extends ArrayBufferView | null>(array: T) => {
        if (array instanceof Uint8Array) array.fill(0xab);
        return array;
      },
    };

    expect(createUuidInAnyContext(source)).toBe("abababab-abab-4bab-abab-abababababab");
  });
});
