import { ActivityWorker, runManagedProcess } from "@partyroom/activity-worker";
import { inferenceCommand, extractMetadataActivity, processResultSchema } from "./activity";
import { validateDevice } from "./model";

export function createHealthHandler(health: () => Record<string, unknown>) {
  return (request: Request) => {
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return Response.json(health());
    }
    return new Response("Not found", { status: 404 });
  };
}

/**
 * dev:mac variants require native Ollama (`brew install ollama`).
 * Each managed inference owns a private instance on 11435 and releases it on exit.
 * Native models are cached in .cache/metadata-models; Docker mounts /models.
 */
async function main() {
  validateDevice(process.env.METADATA_DEVICE ?? "cpu");
  const apiUrl =
    process.env.ACTIVITY_WORKER_API_URL ??
    (process.platform === "darwin"
      ? `http://127.0.0.1:${process.env.SITE_PROXY_PORT ?? "3211"}/activities/workers/`
      : undefined);
  const token = process.env.ACTIVITY_WORKER_TOKEN;
  if (!apiUrl || !token)
    throw new Error("ACTIVITY_WORKER_API_URL and ACTIVITY_WORKER_TOKEN are required");
  if (!Bun.which("ollama")) throw new Error("Ollama is required. On macOS: brew install ollama");

  const shutdown = new AbortController();
  let worker: ActivityWorker | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  const stop = async () => {
    shutdown.abort();
    await worker?.stop();
    server?.stop();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void stop();
    });
  }
  try {
    await runManagedProcess(inferenceCommand("prepare"), {
      signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(600_000)]),
      terminateTimeoutMs: 10_000,
    });
    const verified = await runManagedProcess(inferenceCommand("verify"), {
      signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(120_000)]),
      terminateTimeoutMs: 10_000,
    });
    const { inference } = processResultSchema.parse(JSON.parse(verified.stdout));
    console.log("Metadata inference verified:", inference);
    worker = new ActivityWorker({
      apiUrl,
      token,
      workerId: process.env.ACTIVITY_WORKER_ID ?? "metadata-worker",
      taskQueue: extractMetadataActivity.definition.queue.name,
      maxConcurrentActivities: 1,
      activities: [extractMetadataActivity],
    });
    if (shutdown.signal.aborted) return;
    worker.start();
    const runningWorker = worker;
    server = Bun.serve({
      hostname: process.env.HOST ?? "127.0.0.1",
      port: Number(process.env.METADATA_WORKER_PORT ?? process.env.PORT ?? 4500),
      fetch: createHealthHandler(() => ({
        ...runningWorker.health(),
        inference,
        residentModel: false,
      })),
    });
    console.log(`Metadata activity worker listening on ${server.url}`);
  } catch (error) {
    const interrupted = shutdown.signal.aborted;
    await stop();
    if (!interrupted) throw error;
  }
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
