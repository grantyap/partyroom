import type { WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { workflowStatus } from "../activities/workflowManager";

export function isDraining() {
  return process.env.MEDIA_WORKFLOW_DRAIN === "1";
}

export const statusPage = internalQuery({
  args: {
    table: v.union(v.literal("mediaJobs"), v.literal("mediaEnrichments")),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.object({
    continueCursor: v.string(),
    isDone: v.boolean(),
    draining: v.boolean(),
    scanned: v.number(),
    queued: v.number(),
    active: v.array(v.string()),
  }),
  handler: async (ctx, { table, cursor, limit }) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error("limit must be between 1 and 50");
    const pagination = { cursor, numItems: limit };
    const page =
      table === "mediaJobs"
        ? await ctx.db.query("mediaJobs").paginate(pagination)
        : await ctx.db.query("mediaEnrichments").paginate(pagination);
    const active: string[] = [];
    let queued = 0;
    for (const row of page.page) {
      if (row.state === "queued" && !row.workflowId) queued += 1;
      if (row.state === "processing") {
        active.push(row._id);
        continue;
      }
      if (!row.workflowId) continue;
      try {
        if ((await workflowStatus(ctx, row.workflowId as WorkflowId)).type === "inProgress")
          active.push(row._id);
      } catch {
        // A missing journal for a terminal row cannot resume work.
      }
    }
    return {
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      draining: isDraining(),
      scanned: page.page.length,
      queued,
      active,
    };
  },
});
