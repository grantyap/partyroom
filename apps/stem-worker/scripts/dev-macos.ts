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
  console.error("dev:stem:mac requires an Apple Silicon Mac.");
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

console.log("Preparing the native Apple Silicon Python environment...");
run(
  "uv",
  ["sync", "--locked", "--group", "mac", "--reinstall-package", "partyroom-activity-worker"],
  workerDirectory,
);

const python = join(workerDirectory, ".venv", "bin", "python");
const acceleratorCheck = spawnSync(
  python,
  [
    "-c",
    [
      "import mlx.core as mx",
      "value = mx.array([1.0, 2.0]) + 1",
      "mx.eval(value)",
      "print('MLX device:', mx.default_device())",
    ].join("; "),
  ],
  { cwd: workerDirectory, stdio: "inherit" },
);

if (acceleratorCheck.status !== 0) {
  console.error("MLX Metal acceleration is unavailable; refusing to start the native stem worker.");
  process.exit(acceleratorCheck.status ?? 1);
}

const cacheDirectory =
  process.env.STEM_WORKER_CACHE_DIR ??
  join(homedir(), "Library", "Caches", "partyroom", "stem-worker");
const siteProxyPort = process.env.SITE_PROXY_PORT ?? "3211";
const convexPort = process.env.PORT ?? "3210";
const environment = {
  ...process.env,
  ACTIVITY_ARTIFACT_ORIGIN:
    process.env.ACTIVITY_ARTIFACT_ORIGIN ?? `http://127.0.0.1:${convexPort}`,
  ACTIVITY_WORKER_API_URL:
    process.env.ACTIVITY_WORKER_API_URL ?? `http://127.0.0.1:${siteProxyPort}/activities/workers/`,
  ACTIVITY_WORKER_ID: process.env.ACTIVITY_WORKER_ID ?? "stem-worker-macos",
  HOST: process.env.STEM_WORKER_HOST ?? "127.0.0.1",
  MODEL_DIR: process.env.MODEL_DIR ?? join(cacheDirectory, "models"),
  STEM_BACKEND: "mlx",
  STEM_MDX_BATCH_SIZE: process.env.STEM_MDX_BATCH_SIZE ?? "2",
  STEM_MDX_OVERLAP: process.env.STEM_MDX_OVERLAP ?? "0.1",
  STEM_MLX_CACHE_CLEAR_POLICY: process.env.STEM_MLX_CACHE_CLEAR_POLICY ?? "deferred",
  STEM_MLX_SPEED_MODE: process.env.STEM_MLX_SPEED_MODE ?? "default",
  STEM_WRITE_WORKERS: process.env.STEM_WRITE_WORKERS ?? "2",
  PATH: `${join(workerDirectory, ".venv", "bin")}${delimiter}${process.env.PATH ?? ""}`,
  PORT: process.env.STEM_WORKER_PORT ?? "4200",
  WORK_DIR: process.env.WORK_DIR ?? join(cacheDirectory, "work"),
};

console.log(`Starting the MLX stem worker at http://${environment.HOST}:${environment.PORT}`);
const worker = spawn(
  python,
  ["-m", "uvicorn", "app.main:app", "--host", environment.HOST, "--port", environment.PORT],
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
