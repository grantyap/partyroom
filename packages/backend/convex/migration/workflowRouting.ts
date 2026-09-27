import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

const migrationId = "workflow-state-redesign-v1";

export async function workflowVersion(ctx: Pick<MutationCtx, "db">): Promise<1 | 2> {
  const state = await ctx.db
    .query("migrationRuns")
    .withIndex("by_migration_id", (q) => q.eq("migrationId", migrationId))
    .unique();
  return state?.routingVersion ?? 1;
}

export function rowWorkflowVersion(
  row: Pick<Doc<"mediaJobs"> | Doc<"mediaEnrichments">, "workflowVersion">,
): 1 | 2 {
  return row.workflowVersion ?? 1;
}
