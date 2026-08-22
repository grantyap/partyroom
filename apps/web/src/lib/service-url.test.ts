import { describe, expect, test } from "bun:test";
import { browserReachableServiceUrl } from "./service-url";

describe("browserReachableServiceUrl", () => {
  test("routes loopback storage URLs through the same-origin media proxy", () => {
    expect(
      browserReachableServiceUrl(
        "http://127.0.0.1:3210/api/storage/file?id=one#fragment",
        "http://192.168.1.238:3210",
      ),
    ).toBe("/api/media/api/storage/file?id=one#fragment");
  });

  test("handles public, localhost, and IPv6 storage origins", () => {
    expect(
      browserReachableServiceUrl(
        "http://partyroom.test:3210/api/storage/public",
        "http://partyroom.test:3210",
      ),
    ).toBe("/api/media/api/storage/public");
    expect(
      browserReachableServiceUrl(
        "http://localhost:3210/api/storage/local",
        "http://partyroom.test:3210",
      ),
    ).toBe("/api/media/api/storage/local");
    expect(
      browserReachableServiceUrl(
        "http://[::1]:3210/api/storage/v6",
        "http://partyroom.test:3210",
      ),
    ).toBe("/api/media/api/storage/v6");
  });

  test("does not proxy non-storage service endpoints", () => {
    expect(
      browserReachableServiceUrl("http://127.0.0.1:3210/version", "http://partyroom.test:3210"),
    ).toBe("http://127.0.0.1:3210/version");
    expect(
      browserReachableServiceUrl(
        "http://partyroom.test:3210/api/query",
        "http://partyroom.test:3210",
      ),
    ).toBe("http://partyroom.test:3210/api/query");
  });

  test("does not proxy an unrelated storage host", () => {
    expect(
      browserReachableServiceUrl(
        "https://cdn.example/api/storage/video.mp4",
        "http://192.168.1.238:3210",
      ),
    ).toBe("https://cdn.example/api/storage/video.mp4");
  });

  test("returns malformed URLs unchanged", () => {
    expect(browserReachableServiceUrl("not a URL", "http://192.168.1.238:3210")).toBe(
      "not a URL",
    );
  });
});
