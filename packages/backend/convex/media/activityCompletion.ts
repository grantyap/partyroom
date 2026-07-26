import type { ActivityCompletionArgs } from "@partyroom/activities";
import { v } from "convex/values";
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
    await recordActivityTerminal(ctx, args.context.jobId, args.activityId);
    return null;
  },
});
