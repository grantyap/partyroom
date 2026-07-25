import { WorkflowManager } from "@convex-dev/workflow";
import { ActivityManager, ManagedWorkflowManager } from "@partyroom/activities";
import { components, internal } from "../_generated/api";

export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: 10 },
});

export const activities = new ActivityManager(components.activities);

export const managedWorkflow: ManagedWorkflowManager = new ManagedWorkflowManager(
  workflow,
  activities,
  internal.activities.managedWorkflow.onComplete,
);
