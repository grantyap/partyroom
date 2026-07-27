import type { ActivityCompletionArgs } from "@partyroom/activities";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { recordActivityTerminal } from "./service";

type Context = {
  jobId: Id<"mediaJobs">;
};

export const onComplete = internalMutation({
  args: {
    activityId: v.string(),
    context: v.object({
      jobId: v.id("mediaJobs"),
    }),
    result: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args: ActivityCompletionArgs<Context>) => {
    const status = await ctx.runQuery(components.activities.activities.get, {
      activityId: args.activityId as any,
    });
    await recordActivityTerminal(
      ctx,
      args.context.jobId,
      args.activityId,
      status?.startedAt !== undefined && status.completedAt !== undefined
        ? { startedAt: status.startedAt, completedAt: status.completedAt }
        : undefined,
    );
    return null;
  },
});
