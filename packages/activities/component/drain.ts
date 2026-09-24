import { v } from "convex/values";
import { query } from "./_generated/server";

export const statusPage = query({
  args: { cursor: v.union(v.string(), v.null()), limit: v.number() },
  returns: v.object({
    continueCursor: v.string(),
    isDone: v.boolean(),
    scanned: v.number(),
    active: v.array(v.string()),
  }),
  handler: async (ctx, { cursor, limit }) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error("limit must be between 1 and 50");
    const page = await ctx.db.query("activities").paginate({ cursor, numItems: limit });
    return {
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      scanned: page.page.length,
      active: page.page
        .filter(
          (activity) =>
            activity.state === "scheduled" ||
            activity.state === "running" ||
            activity.deliveryState === "pending",
        )
        .map((activity) => activity._id),
    };
  },
});
