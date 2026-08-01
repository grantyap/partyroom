import { vWorkflowId, type WorkflowId } from "@convex-dev/workflow";
import { type ActivityDefinition, type ActivityInput } from "@partyroom/activities";
import { type ObjectType, type PropertyValidators } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";

/**
 * Defines the durable query boundary that builds an activity's input.
 *
 * Managed workflows cannot read the application database directly, so an
 * activity step may need an internal query to translate workflow arguments and
 * current database state into the worker-facing activity input. This helper
 * adds the injected `workflowId`, uses the activity's input validator as the
 * query return validator, and keeps the handler fully typed.
 *
 * Keep reusable reads in plain domain functions and call them from this thin
 * registered query. If the workflow already has the complete worker input,
 * omit the builder and pass that input directly to the activity step instead.
 *
 * @see {@link activityStep}
 * @see {@link defineActivity}
 */
export function defineActivityInput<
  Definition extends ActivityDefinition,
  const Args extends PropertyValidators,
>(config: {
  activity: Definition;
  args: Args;
  handler: (
    ctx: QueryCtx,
    args: ObjectType<Args> & { workflowId: WorkflowId },
  ) => Promise<ActivityInput<Definition>> | ActivityInput<Definition>;
}) {
  return internalQuery({
    args: {
      ...config.args,
      workflowId: vWorkflowId,
    },
    returns: config.activity.input,
    handler: async (ctx, args) =>
      await config.handler(ctx, args as ObjectType<Args> & { workflowId: WorkflowId }),
  });
}
