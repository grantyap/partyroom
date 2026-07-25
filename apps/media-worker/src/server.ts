import { join } from "node:path";
import { ActivityWorker, defineHandler, type ActivityContext } from "@partyroom/activity-worker";
import { mediaActivities } from "@partyroom/media-activities";
import {
  downloadActivity,
  extractAudioActivity,
  muxActivity,
  resolveActivity,
  type MediaActivityReporter,
} from "./process";

const port = Number(process.env.PORT ?? 4_100);
const apiUrl = process.env.ACTIVITY_WORKER_API_URL;
const token = process.env.ACTIVITY_WORKER_TOKEN;
if (!apiUrl || !token)
  throw new Error("ACTIVITY_WORKER_API_URL and ACTIVITY_WORKER_TOKEN are required");

function reporter(context: ActivityContext): MediaActivityReporter {
  return {
    progress: async (_stage, progress, message) => {
      if (progress !== undefined) await context.reportProgress(progress, message);
      else await context.heartbeat(message);
    },
    uploadArtifact: context.uploadArtifact,
    runProcess: context.runProcess,
  };
}

async function withDirectory<T>(
  context: ActivityContext,
  execute: (directory: string) => Promise<T>,
) {
  const directory = join(
    process.env.WORK_DIR ?? "/work",
    `${context.info.activityId}-${context.info.attempt}`,
  );
  await Bun.$`mkdir -p ${directory}`.quiet();
  try {
    return await execute(directory);
  } finally {
    await Bun.$`rm -rf ${directory}`.quiet();
  }
}

const worker = new ActivityWorker({
  apiUrl,
  token,
  workerId: process.env.ACTIVITY_WORKER_ID ?? "media-worker",
  taskQueue: "media",
  maxConcurrentActivities: Number(process.env.MEDIA_WORKER_CONCURRENCY ?? 2),
  activities: [
    defineHandler(
      mediaActivities.resolve,
      async (context, input) => await resolveActivity(input.jobId, reporter(context)),
    ),
    defineHandler(
      mediaActivities.download,
      async (context, input) =>
        await withDirectory(context, (directory) =>
          downloadActivity(input.jobId, reporter(context), directory),
        ),
    ),
    defineHandler(
      mediaActivities.extractAudio,
      async (context, input) =>
        await withDirectory(context, (directory) =>
          extractAudioActivity(input.sourceUrl, reporter(context), directory),
        ),
    ),
    defineHandler(
      mediaActivities.mux,
      async (context, input) =>
        await withDirectory(context, (directory) =>
          muxActivity(input.videoUrl, input.instrumentalUrl, reporter(context), directory),
        ),
    ),
  ],
});

worker.start();

const server = Bun.serve({
  port,
  hostname: process.env.HOST ?? "0.0.0.0",
  fetch(request) {
    if (request.method === "GET" && new URL(request.url).pathname === "/health")
      return Response.json(worker.health());
    return new Response("Not found", { status: 404 });
  },
});

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await worker.stop();
    server.stop();
  });
