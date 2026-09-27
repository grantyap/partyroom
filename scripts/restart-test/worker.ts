import { ActivityWorker, defineHandler } from "../../packages/activity-worker/src/index";
import { mediaActivities } from "../../packages/media-activities/src/registry";
import { join } from "node:path";

const directory = process.env.RESTART_TEST_DIRECTORY!;
const apiUrl = `${process.env.RESTART_TEST_API!}/`;
const token = process.env.RESTART_TEST_TOKEN!;
const types = new Map<string, string>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fetchWithLostResponse: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (String(input).endsWith("/complete") && response.ok) {
    const body = JSON.parse(String(init?.body));
    if (
      types.get(body.attemptToken) === "mux" &&
      !(await Bun.file(join(directory, "lost-response.json")).exists())
    ) {
      // The server committed. Simulate the connection dying before delivery to the runtime.
      await Bun.write(join(directory, "lost-response.json"), JSON.stringify(body));
      await new Promise(() => {});
    }
  }
  return response;
};
for (const queue of ["media", "stems", "annotations"]) {
  const definitions = Object.values(mediaActivities).filter((d) => d.queue.name === queue);
  const worker = new ActivityWorker({
    apiUrl,
    token,
    workerId: `restart-${queue}`,
    taskQueue: queue,
    idlePollIntervalMs: 100,
    fetch: fetchWithLostResponse,
    activities: definitions.map((definition) =>
      defineHandler(definition, async (ctx, input: any) => {
        const name = definition.name.split(".")[1]!;
        types.set(ctx.info.attemptToken, name);
        for (const [key, value] of Object.entries(input))
          if (key.endsWith("Url")) {
            const response = await fetch(value as string);
            if (!response.ok) throw new Error(`Missing input ${key}: ${response.status}`);
            await response.arrayBuffer();
          }
        const output: any = {};
        for (const [key, schema] of Object.entries(definition.outputSchema.fields)) {
          if (schema.kind === "optional") continue;
          output[key] =
            schema.kind === "artifact"
              ? await ctx.uploadArtifact(
                  key,
                  new Blob([`restart fixture ${name} ${ctx.info.attempt}`]),
                  "application/octet-stream",
                )
              : schema.kind === "number"
                ? 10
                : key === "sourceId"
                  ? "restart-test"
                  : "restart-fixture";
        }
        if (name === "resolve") {
          output.duration = 10;
          output.title = "Restart fixture";
        }
        await Bun.write(
          join(directory, `${name}-${ctx.info.attempt}.json`),
          JSON.stringify({
            activityId: ctx.info.activityId,
            attemptToken: ctx.info.attemptToken,
            output,
          }),
        );
        while (!(await Bun.file(join(directory, `allow-${name}`)).exists())) {
          if (ctx.signal.aborted) throw new Error("Lease lost");
          await sleep(100);
        }
        return output;
      }),
    ),
  });
  worker.start();
}
await new Promise(() => {});
