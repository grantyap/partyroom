import {
  activityCompletionResultValidator,
  activityWorkflowCompletionContextValidator,
  type ActivityWorkflowCompletionArgs,
} from "@partyroom/activities/internal";
import type { FunctionHandle } from "convex/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { sendWorkflowEvent } from "./workflowManager";

export const onComplete = internalMutation({
  args: {
    activityId: v.string(),
    result: activityCompletionResultValidator,
    context: activityWorkflowCompletionContextValidator,
  },
  returns: v.null(),
  handler: async (ctx, args: ActivityWorkflowCompletionArgs) => {
    await ctx.runMutation(components.activities.workflowSteps.finishActivity, {
      activityId: args.activityId as any,
      state:
        args.result.kind === "success"
          ? "completed"
          : args.result.kind === "failed"
            ? "failed"
            : "canceled",
      error: args.result.kind === "failed" ? args.result.errorMessage : undefined,
    });
    const completion = args.context.completion;
    if (completion) {
      await ctx.runMutation(completion.fnHandle as FunctionHandle<"mutation">, {
        activityId: args.activityId,
        result: args.result,
        context: completion.context,
      });
    }
    await sendWorkflowEvent(
      ctx,
      args.result.kind === "success"
        ? {
            workflowId: args.context.workflowId,
            name: args.activityId,
            value: args.result.value,
          }
        : {
            workflowId: args.context.workflowId,
            name: args.activityId,
            error: args.result.kind === "failed" ? args.result.errorMessage : "Activity canceled",
          },
    );
    return null;
  },
});
