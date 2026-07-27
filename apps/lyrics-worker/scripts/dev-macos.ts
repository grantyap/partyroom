import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const workerDirectory = resolve(scriptDirectory, "..");

function run(command: string, args: string[], cwd = repositoryRoot): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.platform !== "darwin" || process.arch !== "arm64") {
  console.error("dev:mac for lyrics requires an Apple Silicon Mac.");
  process.exit(1);
}

if (!process.env.ACTIVITY_WORKER_TOKEN) {
  console.error("ACTIVITY_WORKER_TOKEN must be set in .env.");
  process.exit(1);
}

if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) {
  console.error("ffmpeg is required. Install it with: brew install ffmpeg");
  process.exit(1);
}

console.log("Preparing the native Apple Silicon MLX environment...");
run(
  "uv",
  [
    "sync",
    "--locked",
    "--group",
    "mac",
    "--reinstall-package",
    "partyroom-activity-worker",
  ],
  workerDirectory,
);

const python = join(workerDirectory, ".venv", "bin", "python");
const mlxCheck = spawnSync(
  python,
  [
    "-c",
    [
      "import mlx.core as mx",
      "value = mx.sum(mx.ones((16, 16)))",
      "mx.eval(value)",
      "print('MLX Metal acceleration is available')",
    ].join("; "),
  ],
  { cwd: workerDirectory, stdio: "inherit" },
);

if (mlxCheck.status !== 0) {
  console.error(
    "MLX is unavailable; refusing to start the native lyrics worker.",
  );
  process.exit(mlxCheck.status ?? 1);
}

const cacheDirectory =
  process.env.LYRICS_WORKER_CACHE_DIR ??
  join(homedir(), "Library", "Caches", "partyroom", "lyrics-worker");
const siteProxyPort = process.env.SITE_PROXY_PORT ?? "3211";
const convexPort = process.env.PORT ?? "3210";
const environment = {
  ...process.env,
  ACTIVITY_ARTIFACT_ORIGIN:
    process.env.ACTIVITY_ARTIFACT_ORIGIN ?? `http://127.0.0.1:${convexPort}`,
  ACTIVITY_WORKER_API_URL:
    process.env.ACTIVITY_WORKER_API_URL ??
    `http://127.0.0.1:${siteProxyPort}/activities/workers/`,
  ACTIVITY_WORKER_ID:
    process.env.LYRICS_ACTIVITY_WORKER_ID ?? "lyrics-worker-macos",
  HF_HOME: process.env.HF_HOME ?? join(cacheDirectory, "models"),
  HOST: process.env.LYRICS_WORKER_HOST ?? "127.0.0.1",
  LYRICS_BACKEND: "mlx",
  PATH: `${join(workerDirectory, ".venv", "bin")}${delimiter}${process.env.PATH ?? ""}`,
  PORT: process.env.LYRICS_WORKER_PORT ?? "4300",
  WORK_DIR: process.env.LYRICS_WORK_DIR ?? join(cacheDirectory, "work"),
};

console.log(
  `Starting the MLX lyrics worker at http://${environment.HOST}:${environment.PORT}`,
);
const worker = spawn(
  python,
  [
    "-m",
    "uvicorn",
    "app.main:app",
    "--host",
    environment.HOST,
    "--port",
    environment.PORT,
  ],
  {
    cwd: workerDirectory,
    detached: true,
    env: environment,
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => worker.kill(signal));
}

worker.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

process.exitCode = await new Promise<number>((resolveExit) => {
  worker.on("exit", (code, signal) => {
    resolveExit(code ?? (signal ? 1 : 0));
  });
});
