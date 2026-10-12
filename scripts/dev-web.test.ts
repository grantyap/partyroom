import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { httpsConfig, webhookTunnelArgs, webhookUrls } from "./dev-web";

test("LAN HTTPS uses one stable hostname and loopback upstreams", () => {
  const config = httpsConfig("pmm.local");
  expect(config).toContain("https://pmm.local {");
  expect(config).toContain("https://pmm.local:8443 {");
  expect(config).toContain("reverse_proxy 127.0.0.1:5173");
  expect(config).toContain("reverse_proxy 127.0.0.1:3210");
  expect(config).toContain("skip_install_trust");
  expect(httpsConfig("another-mac.local", "33210")).toContain("127.0.0.1:33210");
});

test("webhook tunnel only forwards to the local HTTP port", () => {
  expect(webhookTunnelArgs()).toEqual(["tunnel", "--url", "http://127.0.0.1:3211"]);
  expect(webhookTunnelArgs("33211")).toEqual(["tunnel", "--url", "http://127.0.0.1:33211"]);
  for (const port of ["0", "65536", "3211/path", "https://partyroom.lol"])
    expect(() => webhookTunnelArgs(port)).toThrow();
});

test("cloudflared output produces complete webhook URLs", () => {
  expect(webhookUrls("waiting for tunnel...")).toBeNull();
  expect(webhookUrls("INF | https://random-test-name.trycloudflare.com |\n")).toEqual({
    stripe: "https://random-test-name.trycloudflare.com/stripe/webhook",
    resend: "https://random-test-name.trycloudflare.com/resend/webhook",
  });
});

test("development launcher starts and stops the tunnel with Vite", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "partyroom-dev-tunnel-"));
  await mkdir(resolve(directory, "scripts"));
  await mkdir(resolve(directory, "apps/web"), { recursive: true });
  await symlink(resolve(import.meta.dir, "../node_modules"), resolve(directory, "node_modules"));
  await writeFile(
    resolve(directory, "scripts/dev-web.ts"),
    await readFile(resolve(import.meta.dir, "dev-web.ts")),
  );
  const fake = `#!${process.execPath}
const name = process.argv[1].split('/').pop();
await Bun.write(process.env.TASK_TEST_DIR + '/' + name + '.args', JSON.stringify(process.argv.slice(2)));
process.on('SIGTERM', async () => {
  await Bun.write(process.env.TASK_TEST_DIR + '/' + name + '.stopped', 'yes');
  process.exit(0);
});
setInterval(() => {}, 1000);
`;
  for (const command of ["bun", "cloudflared"]) {
    await writeFile(resolve(directory, command), fake);
    await chmod(resolve(directory, command), 0o755);
  }
  const child = spawn(process.execPath, [resolve(directory, "scripts/dev-web.ts")], {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      TASK_TEST_DIR: directory,
      DEV_WEBHOOK_TUNNEL: "true",
      DEV_HTTPS_HOST: "",
      SITE_PROXY_PORT: "33211",
    },
    stdio: "ignore",
  });
  const exited = new Promise<number | null>((done) => child.on("exit", done));
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await Bun.file(resolve(directory, "bun.args")).exists()) break;
      await Bun.sleep(10);
    }
    expect(JSON.parse(await readFile(resolve(directory, "cloudflared.args"), "utf8"))).toEqual(
      webhookTunnelArgs("33211"),
    );
    expect(JSON.parse(await readFile(resolve(directory, "bun.args"), "utf8"))).toContain("vite");
    child.kill("SIGTERM");
    expect(await exited).toBe(143);
    for (const command of ["bun", "cloudflared"])
      expect(await readFile(resolve(directory, `${command}.stopped`), "utf8")).toBe("yes");
  } finally {
    child.kill("SIGTERM");
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
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
