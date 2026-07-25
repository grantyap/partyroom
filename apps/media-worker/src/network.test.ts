import { describe, expect, test } from "bun:test";
import { isPrivateIp } from "./network";

describe("isPrivateIp", () => {
  test.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.1.2",
    "::1",
    "fd00::1",
  ])("blocks %s", (address) => expect(isPrivateIp(address)).toBe(true));

  test.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("allows %s", (address) =>
    expect(isPrivateIp(address)).toBe(false),
  );
});
