import type { ActivityCompletionArgs } from "@partyroom/activities";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { recordActivityTerminal } from "./service";
import { mediaOperationKind, type OperationKind } from "./validators";
import { workflow } from "../activities/workflowManager";

type Context = {
  jobId: Id<"mediaJobs">;
  workflowId: string;
  kind: OperationKind;
};

export const onComplete = internalMutation({
  args: {
    activityId: v.string(),
    context: v.object({
      jobId: v.id("mediaJobs"),
      workflowId: v.string(),
      kind: mediaOperationKind,
    }),
    result: v.any(),
  },
  handler: async (ctx, args: ActivityCompletionArgs<Context>) => {
    await recordActivityTerminal(ctx, args.context.jobId, args.activityId);
    await workflow.sendEvent(
      ctx,
      args.result.kind === "success"
        ? {
            workflowId: args.context.workflowId as any,
            name: args.activityId,
            value: args.result.value,
          }
        : {
            workflowId: args.context.workflowId as any,
            name: args.activityId,
            error: args.result.kind === "failed" ? args.result.errorMessage : "Activity canceled",
          },
    );
  },
});
