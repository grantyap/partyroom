import {
  managedWorkflowCompletionContextValidator,
  settleManagedWorkflow,
  type ManagedWorkflowCompletionArgs,
} from "@partyroom/activities/internal";
import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";

const MAX_RETRY_DELAY_MS = 5 * 60_000;
const MAX_SETTLEMENT_ATTEMPTS = 20;

const completionArgs = {
  workflowId: vWorkflowId,
  result: vResultValidator,
  context: managedWorkflowCompletionContextValidator,
};

async function settle(ctx: MutationCtx, args: ManagedWorkflowCompletionArgs, attempt: number) {
  try {
    await settleManagedWorkflow(ctx, components.activities, args);
  } catch (error) {
    console.error(`Unable to settle managed workflow ${args.workflowId}`, error);
    if (attempt >= MAX_SETTLEMENT_ATTEMPTS) return;
    await ctx.scheduler.runAfter(
      Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** Math.min(attempt, 8)),
      internal.activities.managedWorkflow.retry,
      { ...args, attempt: attempt + 1 },
    );
  }
}

export const onComplete = internalMutation({
  args: completionArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await settle(ctx, args, 0);
    return null;
  },
});

export const retry = internalMutation({
  args: {
    ...completionArgs,
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { attempt, ...args }) => {
    await settle(ctx, args, attempt);
    return null;
  },
});
