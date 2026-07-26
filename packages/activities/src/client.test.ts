import { describe, expect, expectTypeOf, test } from "vitest";
import type { WorkflowId } from "@convex-dev/workflow";
import {
  ActivityManager,
  defineActivity,
  defineActivityRegistry,
  defineQueue,
  wire,
  type ActivityInput,
  type ActivityOutput,
} from "./client";

describe("typed activity registry", () => {
  test("preserves queue names and activity input/output types", () => {
    const stems = defineQueue("stems", {
      leaseDurationMs: 30_000,
      maxConcurrentActivities: 1,
    });
    const separate = defineActivity({
      name: "media.separate",
      version: 1,
      queue: stems,
      input: wire.object({ audioStorageId: wire.string }),
      output: wire.object({
        instrumentalStorageId: wire.string,
        vocalsStorageId: wire.string,
      }),
      startToCloseTimeoutMs: 45 * 60_000,
      scheduleToCloseTimeoutMs: 2 * 60 * 60_000,
    });
    const registry = defineActivityRegistry({
      queues: { stems },
      activities: { separate },
    });

    expect(registry.activities.separate.name).toBe("media.separate");
    expect(registry.activities.separate.queue.name).toBe("stems");
    expectTypeOf<ActivityInput<typeof separate>>().toMatchTypeOf<{
      audioStorageId: string;
    }>();
    expectTypeOf<ActivityOutput<typeof separate>>().toMatchTypeOf<{
      instrumentalStorageId: string;
      vocalsStorageId: string;
    }>();
  });

  test("schedules through a workflow without exposing its artifact scope", async () => {
    const queue = defineQueue("media", { leaseDurationMs: 30_000 });
    const activity = defineActivity({
      name: "media.render",
      version: 1,
      queue,
      input: wire.object({ sourceUrl: wire.string }),
      output: wire.object({ output: wire.artifact("retained") }),
      startToCloseTimeoutMs: 60_000,
      scheduleToCloseTimeoutMs: 120_000,
    });
    const component = {
      artifacts: { getScopeForWorkflow: "get-scope" },
      activities: { schedule: "schedule" },
    };
    const manager = new ActivityManager(component as never);
    const runQuery = async () => "scope-1";
    const runMutation = async (_fn: unknown, args: unknown) => {
      expect(args).toMatchObject({
        artifactScopeId: "scope-1",
        artifactSlots: ["output"],
      });
      return "activity-1";
    };

    await expect(
      manager.schedule({ runQuery, runMutation } as never, "workflow-1" as WorkflowId, activity, {
        sourceUrl: "https://example.com/source",
      }),
    ).resolves.toBe("activity-1");
  });
});
