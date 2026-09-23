import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const backend = resolve(root, "packages/backend");
const envFile = resolve(backend, ".env.local");
const modes = { docker: "", mac: "docker-compose.mac.yaml", nvidia: "docker-compose.nvidia.yaml" };
const existing = spawnSync(
  "docker",
  [
    "ps",
    "-aq",
    "--filter",
    "label=com.docker.compose.project=partyroom",
    "--filter",
    "label=com.docker.compose.service=backend",
  ],
  { encoding: "utf8" },
);
if (existing.error) throw existing.error;
if (existing.status !== 0) process.exit(existing.status ?? 1);
const container = existing.stdout.trim().split("\n")[0];
const inspected = container
  ? spawnSync(
      "docker",
      ["inspect", "--format", '{{ index .Config.Labels "partyroom.dev.mode" }}', container],
      { encoding: "utf8" },
    )
  : undefined;
if (inspected && inspected.status !== 0) process.exit(inspected.status ?? 1);
const mode = process.argv[2] ?? inspected?.stdout.trim() ?? "docker";
if (!(mode in modes)) throw new Error("Expected setup mode to be docker, mac, or nvidia");
const compose = ["compose", "-f", "docker-compose.yaml", "-f", "docker-compose.dev.yaml"];
if (modes[mode as keyof typeof modes]) compose.push("-f", modes[mode as keyof typeof modes]);

function run(command: string, args: string[], cwd = root, input?: string) {
  const result = spawnSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const env = readFileSync(envFile, "utf8");
if (!/^CONVEX_SELF_HOSTED_ADMIN_KEY=.*$/m.test(env)) {
  throw new Error(`Missing CONVEX_SELF_HOSTED_ADMIN_KEY in ${envFile}`);
}
const settings = env.match(/^(SITE_URL|BETTER_AUTH_SECRET|WORKER_CONVEX_CLOUD_ORIGIN)=.*$/gm);
if (settings?.length !== 3) throw new Error(`Missing Convex function settings in ${envFile}`);
const workerSettings = readFileSync(resolve(root, ".env"), "utf8").match(
  /^(ACTIVITY_WORKER_TOKEN|WORKER_SIGNING_SECRET)=.*$/gm,
);
if (workerSettings?.length !== 2) throw new Error("Missing worker secrets in root .env");

const reuseBackend = container && inspected?.stdout.trim() === mode;
run("docker", [
  ...compose,
  "up",
  "-d",
  "--wait",
  ...(reuseBackend ? ["--no-recreate"] : []),
  "backend",
]);
const key = spawnSync("docker", [...compose, "exec", "-T", "backend", "./generate_admin_key.sh"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["inherit", "pipe", "inherit"],
});
if (key.error) throw key.error;
if (key.status !== 0) process.exit(key.status ?? 1);
const adminKey = key.stdout.trim();
if (!adminKey || adminKey.includes("\n")) throw new Error("Invalid admin key output from backend");
writeFileSync(
  envFile,
  env.replace(/^CONVEX_SELF_HOSTED_ADMIN_KEY=.*$/m, `CONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}`),
  { mode: 0o600 },
);
chmodSync(envFile, 0o600);
console.log("Updated packages/backend/.env.local with this backend's admin key.");

delete process.env.CONVEX_DEPLOYMENT;
run(
  "bunx",
  ["convex", "env", "set", "--force"],
  backend,
  `${[...settings, ...workerSettings].join("\n")}\n`,
);
run("bunx", ["convex", "dev", "--once", "--env-file", ".env.local"], backend);
