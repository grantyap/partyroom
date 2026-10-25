import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  extractMetadata,
  inputSchema,
  loadedModel,
  MODEL,
  ollama,
  OLLAMA_URL,
  validateDevice,
} from "./model";

export async function stopModelProcess(child: ChildProcess) {
  const exited =
    !child.pid || child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((done) => child.once("exit", () => done()));
  const killGroup = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  killGroup("SIGTERM");
  const force = setTimeout(() => killGroup("SIGKILL"), 2_000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
    killGroup("SIGKILL");
  }
}

export async function withOllama<T>(operation: () => Promise<T>, signal: AbortSignal) {
  const binary = Bun.which("ollama");
  if (!binary) throw new Error("Ollama is required");
  signal.throwIfAborted();
  try {
    await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(500) });
    throw new Error("Metadata Ollama port 11435 is already in use");
  } catch (error) {
    if (error instanceof Error && error.message.includes("already in use")) throw error;
  }
  const models =
    process.env.OLLAMA_MODELS ?? resolve(import.meta.dir, "../../../.cache/metadata-models");
  await mkdir(models, { recursive: true });
  const child = spawn(binary, ["serve"], {
    detached: true,
    env: {
      ...process.env,
      OLLAMA_HOST: OLLAMA_URL,
      OLLAMA_MODELS: models,
      OLLAMA_NO_CLOUD: "1",
      OLLAMA_VULKAN: "0",
      OLLAMA_NUM_PARALLEL: "1",
      OLLAMA_MAX_LOADED_MODELS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(process.stderr);
  child.stderr?.pipe(process.stderr);
  const crashed = new AbortController();
  child.once("error", (error) => crashed.abort(error));
  child.once("exit", () => crashed.abort(new Error("Private Ollama exited unexpectedly")));
  const active = AbortSignal.any([signal, crashed.signal]);
  const cancelled = () => {
    void stopModelProcess(child);
  };
  signal.addEventListener("abort", cancelled, { once: true });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      active.throwIfAborted();
      try {
        await ollama("/api/version", undefined, 1_000, active);
        ready = true;
        break;
      } catch {
        active.throwIfAborted();
        await Bun.sleep(200);
      }
    }
    if (!ready) throw new Error("Private Ollama did not become ready");
    return await operation();
  } finally {
    signal.removeEventListener("abort", cancelled);
    await stopModelProcess(child);
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "prepare" && mode !== "verify" && mode !== "extract")
    throw new Error("Unknown metadata process mode");
  const device = validateDevice(process.env.METADATA_DEVICE ?? "cpu");
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => controller.abort());
  const result = await withOllama(async () => {
    if (mode === "prepare") {
      const available = z
        .object({ models: z.array(z.object({ name: z.string() })) })
        .parse(await ollama("/api/tags", undefined, 8_000, controller.signal));
      if (!available.models.some(({ name }) => name === MODEL)) {
        await ollama("/api/pull", { model: MODEL, stream: false }, 600_000, controller.signal);
      }
      return { model: MODEL };
    }
    const input =
      mode === "verify"
        ? { title: "Example Artist - Example Song" }
        : inputSchema.parse(JSON.parse(process.argv[3] ?? "null"));
    const output = await extractMetadata(
      input,
      device,
      mode === "verify" ? 90_000 : 20_000,
      controller.signal,
    );
    const inference = loadedModel(
      await ollama("/api/ps", undefined, 1_000, controller.signal),
      device,
    );
    return {
      metadata: {
        ...(output.artistName ? { artistName: output.artistName } : {}),
        ...(output.trackName ? { trackName: output.trackName } : {}),
      },
      inference,
    };
  }, controller.signal);
  console.log(JSON.stringify(result));
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
