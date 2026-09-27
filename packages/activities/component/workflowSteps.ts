import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const definition = v.object({
  key: v.string(),
  label: v.string(),
  position: v.number(),
  kind: v.union(v.literal("activity"), v.literal("workflow")),
});

// Presentation metadata only. Execution state lives in the workflow journal.
export const register = mutation({
  args: { workflowId: v.string(), steps: v.array(definition) },
  returns: v.null(),
  handler: async (ctx, { workflowId, steps }) => {
    if (steps.length > 100 || new Set(steps.map((s) => s.key)).size !== steps.length)
      throw new Error("Invalid workflow step definitions");
    const existing = await ctx.db
      .query("workflowSteps")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", workflowId))
      .collect();
    if (existing.length) return null;
    for (const step of steps) await ctx.db.insert("workflowSteps", { workflowId, ...step });
    return null;
  },
});

// Calling this through WorkflowCtx records a durable journal marker, not a second state machine.
export const mark = mutation({
  args: {
    workflowId: v.string(),
    key: v.string(),
    state: v.optional(v.string()),
    error: v.optional(v.string()),
    message: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async () => null,
});

export const list = query({
  args: { workflowId: v.string() },
  returns: v.array(definition),
  handler: async (ctx, { workflowId }) =>
    (
      await ctx.db
        .query("workflowSteps")
        .withIndex("by_workflow_id", (q) => q.eq("workflowId", workflowId))
        .take(100)
    ).map(({ key, label, position, kind }) => ({ key, label, position, kind })),
});
