import workpool from "@convex-dev/workpool/test";
import workflow from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { actionGeneric } from "convex/server";
import { v } from "convex/values";
import activitySchema from "../../activities/component/schema";
import { wire } from "@partyroom/activities";
import { components } from "../convex/_generated/api";
import schema from "../convex/schema";
import { modules } from "../convex/test.setup";

const activityModules = {
  ...import.meta.glob("../../activities/component/**/*.{ts,js}"),
  "../../activities/component/testFixture.ts": async () => ({
    upload: actionGeneric({
      args: { body: v.string() },
      handler: (ctx, { body }) => ctx.storage.store(new Blob([body])),
    }),
  }),
};

export function mediaTest(rootModules = modules) {
  const t = convexTest(schema, rootModules);
  workflow.register(t);
  t.registerComponent("activities", activitySchema, activityModules);
  return t;
}

export async function completedArtifacts(
  t: ReturnType<typeof mediaTest>,
  workflowId: string,
  slots: string[],
) {
  let scope = await t.query(components.activities.artifacts.getScopeForWorkflow, { workflowId });
  if (!scope) {
    const scopeId = await t.mutation(components.activities.artifacts.createScope, {});
    await t.mutation(components.activities.artifacts.attachWorkflow, { scopeId, workflowId });
    scope = await t.query(components.activities.artifacts.getScopeForWorkflow, { workflowId });
  }
  const taskQueue = crypto.randomUUID();
  await t.mutation(components.activities.activities.schedule, {
    activityType: "test",
    activityVersion: 1,
    taskQueue,
    queue: { leaseDurationMs: 60000 },
    input: {},
    inputSchema: wire.object({}),
    outputSchema: wire.object(
      Object.fromEntries(slots.map((slot) => [slot, wire.artifact("retained")])),
    ),
    artifactScopeId: scope!,
    retryPolicy: {
      maximumAttempts: 1,
      initialIntervalMs: 1,
      maximumIntervalMs: 1,
      backoffCoefficient: 1,
      nonRetryableErrorTypes: [],
    },
    startToCloseTimeoutMs: 60000,
    scheduleToCloseTimeoutMs: 120000,
  });
  const claim = (await t.mutation(components.activities.activities.claim, {
    protocolVersion: 2,
    taskQueue,
    workerId: taskQueue,
    supportedActivities: [{ name: "test", version: 1 }],
  }))!;
  const outputs: Record<string, string> = {};
  for (const slot of slots) {
    const storageId = await t.action((components.activities as any).testFixture.upload, {
      body: slot,
    });
    outputs[slot] = await t.mutation(components.activities.artifacts.registerUpload, {
      attemptToken: claim.attemptToken,
      slot,
      storageId,
    });
  }
  await t.mutation(components.activities.activities.complete, {
    attemptToken: claim.attemptToken,
    value: outputs,
  });
  return outputs;
}

// Inline workflow steps share globals with convex-test. Resolve Vite imports before
// the workflow engine removes process/crypto from its deterministic environment.
export async function workflowTest() {
  async function preload(source: Record<string, () => Promise<unknown>>, only?: string[]) {
    const entries = await Promise.all(
      Object.entries(source)
        .filter(
          ([key]) =>
            !key.endsWith(".test.ts") &&
            !key.endsWith("convex.config.ts") &&
            (!only || only.some((path) => key.endsWith(path))),
        )
        .map(async ([key, load]) => [key, await load()] as const),
    );
    return {
      ...source,
      ...Object.fromEntries(entries.map(([key, value]) => [key, async () => value])),
    };
  }
  const t = mediaTest(
    await preload(modules, [
      "_generated/api.js",
      "media/jobs.ts",
      "media/pipeline.ts",
      "media/activityInputs/core.ts",
      "activities/activityCompletion.ts",
      "activities/managedWorkflow.ts",
      "playback.ts",
    ]),
  );
  t.registerComponent("workflow", workflow.schema, await preload(workflow.modules));
  t.registerComponent("workflow/workpool", workpool.schema, await preload(workpool.modules));
  t.registerComponent("activities", activitySchema, await preload(activityModules));
  return t;
}
