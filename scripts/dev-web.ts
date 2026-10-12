import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const root = fileURLToPath(new URL("..", import.meta.url));
const webhookUrlsFile = resolve(root, ".cache/dev-webhooks.json");

export function webhookUrls(output: string) {
  const origin = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
  return origin ? { stripe: `${origin}/stripe/webhook`, resend: `${origin}/resend/webhook` } : null;
}

export function webhookTunnelArgs(port = "3211") {
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("SITE_PROXY_PORT must be a valid backend HTTP port.");
  return ["tunnel", "--url", `http://127.0.0.1:${port}`];
}

export function httpsConfig(host: string, port = "3210") {
  if (
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(
      host,
    )
  )
    throw new Error("DEV_HTTPS_HOST must be a hostname, such as pmm.local (no scheme or port).");
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("PORT must be a valid backend port.");
  return `{
  admin off
  auto_https disable_redirects
  skip_install_trust
}
https://${host} {
  tls internal
  reverse_proxy 127.0.0.1:5173
}
https://${host}:8443 {
  tls internal
  reverse_proxy 127.0.0.1:${port}
}
`;
}

async function main() {
  const host = process.env.DEV_HTTPS_HOST?.trim();
  const env = { ...process.env };
  const children = new Set<ReturnType<typeof spawn>>();
  let stopping = false;
  function stop(code: number) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) child.kill("SIGTERM");
    if (env.DEV_WEBHOOK_TUNNEL === "true") void rm(webhookUrlsFile, { force: true });
  }
  process.on("SIGINT", () => stop(130));
  process.on("SIGTERM", () => stop(143));
  function run(
    command: string,
    args: string[],
    cwd: string,
    childEnv = env,
    captureOutput = false,
  ) {
    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      stdio: captureOutput ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    children.add(child);
    child.on("error", (error) => {
      console.error(
        `${command}: ${error.message}${command === "caddy" ? ". Install Caddy to enable LAN HTTPS." : command === "cloudflared" ? ". Install cloudflared with `brew install cloudflared`, or unset DEV_WEBHOOK_TUNNEL." : ""}`,
      );
      stop(1);
    });
    child.on("exit", () => children.delete(child));
    return child;
  }
  try {
    if (env.DEV_WEBHOOK_TUNNEL === "true") {
      await mkdir(resolve(root, ".cache"), { recursive: true });
      await rm(webhookUrlsFile, { force: true });
      if (stopping) return;
      const tunnel = run("cloudflared", webhookTunnelArgs(env.SITE_PROXY_PORT), root, env, true);
      tunnel.on("exit", (code) => stop(code ?? 1));
      let output = "";
      let found = false;
      const showUrls = async (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-8192);
        const urls = webhookUrls(output);
        if (!urls || found || stopping) return;
        found = true;
        await writeFile(webhookUrlsFile, `${JSON.stringify(urls, null, 2)}\n`);
        if (stopping) {
          await rm(webhookUrlsFile, { force: true });
          return;
        }
        console.log(`\nStripe sandbox webhook: ${urls.stripe}\nResend webhook: ${urls.resend}`);
        console.log(`Webhook URLs saved to ${webhookUrlsFile}\n`);
      };
      for (const [stream, destination] of [
        [tunnel.stdout, process.stdout],
        [tunnel.stderr, process.stderr],
      ] as const) {
        stream?.on("data", (chunk: Buffer) => {
          destination.write(chunk);
          void showUrls(chunk).catch((error) => {
            console.error(error);
            stop(1);
          });
        });
      }
      console.log("Starting webhook tunnel; waiting for its public HTTPS URL...");
    }
    if (host) {
      const config = httpsConfig(host, env.PORT);
      const backend = resolve(root, "packages/backend");
      const settings = parse(await readFile(resolve(backend, ".env.local")));
      const backendUrl = new URL(settings.CONVEX_SELF_HOSTED_URL ?? "");
      if (!["localhost", "127.0.0.1", "[::1]"].includes(backendUrl.hostname))
        throw new Error("LAN HTTPS must use a local self-hosted Convex backend.");
      const directory = resolve(root, ".cache/dev-https");
      const certificate = resolve(directory, "caddy/pki/authorities/local/root.crt");
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, "Caddyfile"), config);
      const caddy = run(
        "caddy",
        ["run", "--config", resolve(directory, "Caddyfile"), "--adapter", "caddyfile"],
        root,
        {
          ...env,
          XDG_DATA_HOME: directory,
          XDG_CONFIG_HOME: directory,
        },
      );
      caddy.on("exit", (code) => stop(code ?? 1));
      for (let attempts = 0; ; attempts++) {
        if (stopping) return;
        if (await stat(certificate).catch(() => null)) break;
        if (attempts >= 100)
          throw new Error("Caddy did not create its local CA within 10 seconds.");
        await new Promise((done) => setTimeout(done, 100));
      }
      if (stopping) return;
      // Keep the canonical auth URL; add the exact HTTPS origin alongside loopback development.
      const auth = run(
        "bunx",
        ["convex", "env", "set", "DEV_SITE_URL", `https://${host}`, "--env-file", ".env.local"],
        backend,
      );
      const result = await new Promise<number | null>((done) => auth.on("exit", done));
      if (result !== 0 || stopping) {
        stop(result ?? 1);
        return;
      }
      env.PUBLIC_CONVEX_URL = `https://${host}:8443`;
      env.PUBLIC_CONVEX_SITE_URL = `http://localhost:${env.SITE_PROXY_PORT ?? "3211"}`;
      env.NODE_EXTRA_CA_CERTS = certificate;
      console.log(`\nLAN: https://${host} | Local: http://localhost:5173`);
      console.log(`AirDrop and trust this CA on your iPhone once: ${certificate}\n`);
    }
    if (stopping) return;
    const vite = run(
      "bun",
      [
        "run",
        "vite",
        "dev",
        ...process.argv.slice(2),
        "--port",
        "5173",
        "--strictPort",
        ...(host ? ["--host", "127.0.0.1"] : []),
      ],
      resolve(root, "apps/web"),
    );
    vite.on("exit", (code) => stop(code ?? 1));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    stop(1);
  }
}

if (import.meta.main) await main();
