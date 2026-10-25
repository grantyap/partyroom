import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { extractMetadata, loadedModel, MODEL, validateDevice } from "./model";
import { createHealthHandler } from "./server";
import { extractMetadataActivity, inferenceCommand } from "./activity";
import type { ActivityContext } from "@partyroom/activity-worker";
import { spawn } from "node:child_process";
import { stopModelProcess } from "./inference";

afterEach(() => {
  mock.restore();
});
const running = (gpuBytes: number) => ({
  models: [{ name: MODEL, size: 900_000_000, size_vram: gpuBytes }],
});
const completion = (output: unknown, done_reason = "stop") =>
  Response.json({ done: true, done_reason, message: { content: JSON.stringify(output) } });

test("GPU modes fail instead of silently using CPU", () => {
  expect(() => validateDevice("metal", "linux", "x64")).toThrow("Apple Silicon");
  expect(() => validateDevice("cuda", "darwin", "arm64")).toThrow("Linux");
  expect(() => validateDevice("auto")).toThrow();
  for (const device of ["metal", "cuda"] as const) {
    expect(() => loadedModel(running(0), device)).toThrow("loaded on CPU");
    expect(loadedModel(running(800_000_000), device).device).toBe(device);
  }
  expect(() => loadedModel({ models: [] }, "metal")).toThrow("not loaded");
  expect(() => loadedModel(running(1), "cpu")).toThrow("unexpectedly");
});

test("extraction is bounded, non-thinking, structured and requests GPU layers", async () => {
  let body: Record<string, unknown> = {};
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (_url: unknown, options?: RequestInit) => {
        body = JSON.parse(String(options?.body));
        return completion({ artistName: "Artist", trackName: "Song (Live)" });
      },
      { preconnect: fetch.preconnect },
    ),
  );
  expect(await extractMetadata({ title: "Artist - Song (Live) Official MV" }, "metal")).toEqual({
    artistName: "Artist",
    trackName: "Song (Live)",
  });
  expect(body.think).toBe(false);
  expect(body.stream).toBe(false);
  expect(body.options).toEqual({
    temperature: 0,
    num_ctx: 2048,
    num_predict: 128,
    num_thread: 2,
    num_gpu: 99,
  });
  expect(body.format).toMatchObject({ type: "object", additionalProperties: false });
});

test("CPU is explicit and trustworthy source metadata is preserved", async () => {
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (_url: unknown, options?: RequestInit) => {
        expect(JSON.parse(String(options?.body)).options.num_gpu).toBe(0);
        return completion({ artistName: "Other", trackName: "Song" });
      },
      { preconnect: fetch.preconnect },
    ),
  );
  expect(
    await extractMetadata({ title: "Other - Song", artistName: "Source Artist" }, "cpu"),
  ).toEqual({ artistName: "Source Artist", trackName: "Song" });
});

test("unknown fields are allowed, invented and truncated output is rejected", async () => {
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
    completion({ artistName: null, trackName: null }),
  );
  expect(await extractMetadata({ title: "Unhelpful upload" }, "cpu")).toEqual({
    artistName: null,
    trackName: null,
  });
  fetchMock.mockResolvedValue(completion({ artistName: "Invented", trackName: "Song" }));
  await expect(extractMetadata({ title: "Artist - Song" }, "cpu")).rejects.toThrow("invented");
  fetchMock.mockResolvedValue(completion({ artistName: "Artist", trackName: "Song" }, "length"));
  await expect(extractMetadata({ title: "Artist - Song" }, "cpu")).rejects.toThrow();
});

test("a single title cannot serve as both inferred artist and track", async () => {
  spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(completion({ artistName: "Home", trackName: "Home" }))
    .mockResolvedValueOnce(completion({ artistName: "Home", trackName: "Home" }));
  expect(await extractMetadata({ title: "Home" }, "cpu")).toEqual({
    artistName: null,
    trackName: "Home",
  });
  expect(await extractMetadata({ title: "Home - Home" }, "cpu")).toEqual({
    artistName: "Home",
    trackName: "Home",
  });
});

describe("metadata activity", () => {
  const result = {
    metadata: { artistName: "Artist", trackName: "Song" },
    inference: { device: "cpu", model: MODEL, sizeBytes: 900_000_000, gpuBytes: 0 },
  };
  const context = (runProcess: ActivityContext["runProcess"]): ActivityContext => ({
    info: {
      activityId: "activity",
      activityType: "media.extractMetadata",
      activityVersion: 1,
      taskQueue: "metadata",
      attempt: 1,
      attemptToken: "current-attempt",
      attemptDeadline: Date.now() + 30_000,
      scheduleDeadline: Date.now() + 60_000,
    },
    signal: new AbortController().signal,
    reportProgress: mock(async () => {}),
    heartbeat: async () => {},
    uploadArtifact: async () => {
      throw new Error("Metadata has no file outputs");
    },
    runProcess,
  });

  test("registers the typed queue and runs through the managed process helper", async () => {
    const runProcess = mock(async () => ({
      exitCode: 0,
      stdout: JSON.stringify(result),
      stderr: "",
    }));
    const ctx = context(runProcess);
    expect(extractMetadataActivity.definition.queue.name).toBe("metadata");
    expect(await extractMetadataActivity.execute(ctx, { title: "Artist - Song" })).toEqual(
      result.metadata,
    );
    expect(runProcess).toHaveBeenCalledWith(
      inferenceCommand("extract", { title: "Artist - Song" }),
      { terminateTimeoutMs: 10_000 },
    );
    expect(ctx.reportProgress).toHaveBeenLastCalledWith(1, "Song metadata extracted");
  });

  test("rejects invalid input without starting a model and marks it non-retryable", async () => {
    const runProcess = mock(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    await expect(
      extractMetadataActivity.execute(context(runProcess), { title: "x".repeat(501) }),
    ).rejects.toMatchObject({ nonRetryable: true, type: "InvalidMetadata" });
    expect(runProcess).not.toHaveBeenCalled();
  });

  test("unknown metadata is a successful empty result; invalid output is not", async () => {
    const runProcess = mock(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ ...result, metadata: {} }),
      stderr: "",
    }));
    expect(
      await extractMetadataActivity.execute(context(runProcess), { title: "Unknown" }),
    ).toEqual({});
    runProcess.mockImplementation(async () => ({ exitCode: 0, stdout: "not JSON", stderr: "" }));
    await expect(
      extractMetadataActivity.execute(context(runProcess), { title: "Unknown" }),
    ).rejects.toThrow();
  });

  test("uses the shared hardware lock for startup verification and inference, not downloads", () => {
    const previous = process.env.ACTIVITY_PROCESS_LOCK_PATH;
    process.env.ACTIVITY_PROCESS_LOCK_PATH = "/resource-lock/model.lock";
    try {
      expect(inferenceCommand("verify").slice(0, 3)).toEqual([
        "flock",
        "--no-fork",
        "/resource-lock/model.lock",
      ]);
      expect(inferenceCommand("extract", { title: "Song" }).slice(0, 3)).toEqual([
        "flock",
        "--no-fork",
        "/resource-lock/model.lock",
      ]);
      expect(inferenceCommand("prepare")[0]).toBe(process.execPath);
    } finally {
      if (previous === undefined) delete process.env.ACTIVITY_PROCESS_LOCK_PATH;
      else process.env.ACTIVITY_PROCESS_LOCK_PATH = previous;
    }
  });
});

test("only exposes shared health, not a separate extraction API", async () => {
  const handler = createHealthHandler(() => ({ ok: true, started: true, taskQueue: "metadata" }));
  const response = handler(new Request("http://worker/health"));
  expect(await response.json()).toMatchObject({ started: true, taskQueue: "metadata" });
  expect(handler(new Request("http://worker/extract", { method: "POST" })).status).toBe(404);
});

test("model process cleanup force-stops a process that ignores termination", async () => {
  const child = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 30000)"],
    { detached: true, stdio: "ignore" },
  );
  await Bun.sleep(100);
  await stopModelProcess(child);
  expect(child.signalCode).toBe("SIGKILL");
}, 5_000);

test("activity cancellation reaches the inference HTTP request", async () => {
  const controller = new AbortController();
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (_url: unknown, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), {
            once: true,
          });
        }),
      { preconnect: fetch.preconnect },
    ),
  );
  const pending = extractMetadata({ title: "Artist - Song" }, "cpu", 8_000, controller.signal);
  controller.abort(new Error("Activity cancelled"));
  await expect(pending).rejects.toThrow("Activity cancelled");
});
