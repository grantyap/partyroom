import { WorkflowManager } from "@convex-dev/workflow";
import { ActivityManager, ManagedWorkflowManager } from "@partyroom/activities";
import { components, internal } from "../_generated/api";

const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: 10 },
});

export const activities: ActivityManager = new ActivityManager(
  components.activities,
  internal.activities.activityCompletion.onComplete,
);

export const managedWorkflow: ManagedWorkflowManager = new ManagedWorkflowManager(
  workflow,
  components.activities,
  internal.activities.managedWorkflow.onComplete,
  activities,
);

export const sendWorkflowEvent = workflow.sendEvent.bind(workflow) as WorkflowManager["sendEvent"];
export const cancelWorkflow = workflow.cancel.bind(workflow) as WorkflowManager["cancel"];
