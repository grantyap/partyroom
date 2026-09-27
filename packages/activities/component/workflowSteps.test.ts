/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.{ts,js}");
test("step records contain presentation metadata, not writable lifecycle state", async () => {
  const t = convexTest(schema, modules);
  const steps = [{ key: "download", label: "Download", position: 0, kind: "activity" as const }];
  await t.mutation(api.workflowSteps.register, { workflowId: "workflow", steps });
  await t.mutation(api.workflowSteps.mark, {
    workflowId: "workflow",
    key: "download",
    state: "completed",
  });
  expect(await t.query(api.workflowSteps.list, { workflowId: "workflow" })).toEqual(steps);
  await expect(
    t.mutation(api.workflowSteps.register, { workflowId: "other", steps: [...steps, ...steps] }),
  ).rejects.toThrow();
});
