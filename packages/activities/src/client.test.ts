import { describe, expect, expectTypeOf, test } from "vitest";
import {
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
});
