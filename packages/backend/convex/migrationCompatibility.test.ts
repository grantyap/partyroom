/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.{ts,js}");

test("the expand schema accepts legacy workflow projections", async () => {
  const t = convexTest(schema, modules);
  const jobId = await t.run(async (ctx) => {
    return await ctx.db.insert("mediaJobs", {
      requestKey: "legacy",
      encryptedSource: "source",
      sourceIv: "iv",
      requestedBy: "user",
      state: "processing",
      stage: "download",
      progress: 0.5,
      activeActivities: [{ activityId: "activity", kind: "download" }],
      createdAt: 1,
      updatedAt: 1,
    } as never);
  });

  expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
    stage: "download",
    progress: 0.5,
  });
});
