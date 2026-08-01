import type { ActivityCompletionArgs } from "@partyroom/activities";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

type Context = {
  enrichmentId: Id<"mediaEnrichments">;
};

export const onComplete = internalMutation({
  args: {
    activityId: v.string(),
    context: v.object({
      enrichmentId: v.id("mediaEnrichments"),
    }),
    result: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args: ActivityCompletionArgs<Context>) => {
    const enrichment = await ctx.db.get("mediaEnrichments", args.context.enrichmentId);
    if (!enrichment?.activeActivities) return null;
    const terminalActivity = enrichment.activeActivities.find(
      ({ activityId }) => activityId === args.activityId,
    );
    if (!terminalActivity) return null;
    const status = await ctx.runQuery(components.activities.activities.get, {
      activityId: args.activityId as any,
    });
    const activeActivities = enrichment.activeActivities.filter(
      ({ activityId }) => activityId !== args.activityId,
    );
    const stepTimings =
      status?.startedAt !== undefined && status.completedAt !== undefined
        ? [
            ...(enrichment.stepTimings ?? []).filter(({ kind }) => kind !== terminalActivity.kind),
            {
              kind: terminalActivity.kind,
              startedAt: status.startedAt,
              completedAt: status.completedAt,
            },
          ]
        : enrichment.stepTimings;
    await ctx.db.patch("mediaEnrichments", enrichment._id, {
      activeActivities,
      stepTimings,
      updatedAt: Date.now(),
    });
    return null;
  },
});
