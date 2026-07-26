import type { WorkflowId } from "@convex-dev/workflow";
import { vWorkflowId } from "@convex-dev/workflow";
import { v, type Value } from "convex/values";

export const activityCompletionResultValidator = v.union(
  v.object({
    kind: v.literal("success"),
    value: v.any(),
  }),
  v.object({
    kind: v.literal("failed"),
    errorType: v.string(),
    errorMessage: v.string(),
  }),
  v.object({
    kind: v.literal("canceled"),
  }),
);

export const activityWorkflowCompletionContextValidator = v.object({
  workflowId: vWorkflowId,
  completion: v.optional(
    v.object({
      fnHandle: v.string(),
      context: v.optional(v.any()),
    }),
  ),
});

export type ActivityWorkflowCompletionArgs = {
  activityId: string;
  result:
    | { kind: "success"; value: Value }
    | { kind: "failed"; errorType: string; errorMessage: string }
    | { kind: "canceled" };
  context: {
    workflowId: WorkflowId;
    completion?: {
      fnHandle: string;
      context?: unknown;
    };
  };
};
