import type { QueryCtx } from "./_generated/server";

export async function attemptForToken(ctx: Pick<QueryCtx, "db">, token: string) {
  return await ctx.db
    .query("attempts")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

export async function currentLease(ctx: Pick<QueryCtx, "db">, token: string) {
  const attempt = await attemptForToken(ctx, token);
  const activity = attempt ? await ctx.db.get(attempt.activityId) : null;
  const now = Date.now();
  if (
    !activity ||
    activity.state !== "running" ||
    activity.leaseToken !== token ||
    activity.attempt !== attempt!.attempt ||
    now >= (activity.leaseExpiresAt ?? 0) ||
    now >= (activity.attemptDeadline ?? 0) ||
    now >= activity.scheduleDeadline
  )
    return null;
  return activity;
}
