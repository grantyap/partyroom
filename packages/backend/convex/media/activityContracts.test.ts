import { expect, test } from "vitest";
import { parseWire, wireArtifactDefinitions } from "../../../activities/src/wire";
import { mediaActivities, mediaQueues } from "@partyroom/media-activities";
import contracts from "../../../media-activities/generated/contracts.json";

test("generated contracts match every registry activity", () => {
  expect(contracts).toEqual(
    Object.fromEntries(
      Object.entries(mediaActivities).map(([key, activity]) => [
        key,
        {
          name: activity.name,
          version: activity.version,
          taskQueue: activity.queue.name,
          input: activity.inputSchema,
          output: activity.outputSchema,
          artifacts: wireArtifactDefinitions(activity.outputSchema),
        },
      ]),
    ),
  );
});

test("metadata extraction is isolated, bounded, and represents unknown fields by omission", () => {
  const activity = mediaActivities.extractMetadata;
  expect(activity).toMatchObject({
    name: "media.extractMetadata",
    version: 1,
    queue: { name: "metadata", leaseDurationMs: 30_000, maxConcurrentActivities: 1 },
    startToCloseTimeoutMs: 30_000,
    scheduleToCloseTimeoutMs: 60_000,
    retryPolicy: { maximumAttempts: 3 },
  });
  expect(activity.queue).toBe(mediaQueues.metadata);
  expect(mediaActivities.resolve.scheduleToCloseTimeoutMs).toBe(6 * 60 * 60_000);
  expect(parseWire(activity.inputSchema, { title: "upload" })).toEqual({ title: "upload" });
  expect(parseWire(activity.outputSchema, {})).toEqual({});
  expect(parseWire(activity.outputSchema, { trackName: "Song" })).toEqual({ trackName: "Song" });
  expect(() => parseWire(activity.inputSchema, {})).toThrow();
  expect(() => parseWire(activity.outputSchema, { artistName: null })).toThrow();
  expect(() => parseWire(activity.outputSchema, { trackName: 123 })).toThrow();
});
