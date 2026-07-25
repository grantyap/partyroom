import { describe, expect, test } from "vitest";
import { replaceUrlOrigin } from "./urls";

describe("replaceUrlOrigin", () => {
  test("rewrites the origin without using URL property setters", () => {
    expect(
      replaceUrlOrigin(
        "http://127.0.0.1:3210/api/storage/upload?token=signed#fragment",
        "http://backend:3210",
      ),
    ).toBe("http://backend:3210/api/storage/upload?token=signed#fragment");
  });

  test("uses the root of the configured worker origin", () => {
    expect(replaceUrlOrigin("https://public.example/files/one", "http://backend:3211/base/")).toBe(
      "http://backend:3211/files/one",
    );
  });
});
