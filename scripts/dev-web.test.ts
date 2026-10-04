import { expect, test } from "bun:test";
import { httpsConfig } from "./dev-web";

test("LAN HTTPS uses one stable hostname and loopback upstreams", () => {
  const config = httpsConfig("pmm.local");
  expect(config).toContain("https://pmm.local {");
  expect(config).toContain("https://pmm.local:8443 {");
  expect(config).toContain("reverse_proxy 127.0.0.1:5173");
  expect(config).toContain("reverse_proxy 127.0.0.1:3210");
  expect(config).toContain("skip_install_trust");
  expect(httpsConfig("another-mac.local", "33210")).toContain("127.0.0.1:33210");
});

test("host and port cannot inject Caddy configuration", () => {
  for (const host of [
    "",
    "https://pmm.local",
    "pmm.local:443",
    "pmm.local\n}",
    "*.local",
    "-pmm.local",
  ])
    expect(() => httpsConfig(host)).toThrow();
  for (const port of ["0", "65536", "3210\n}", "http://localhost"])
    expect(() => httpsConfig("pmm.local", port)).toThrow();
});
