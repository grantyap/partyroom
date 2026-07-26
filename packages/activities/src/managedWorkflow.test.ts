import { describe, expect, test, vi } from "vitest";
import type { WorkflowId } from "@convex-dev/workflow";
import { ManagedWorkflowManager, settleManagedWorkflow } from "./managedWorkflow";

const scopeId = "scope-1";
const workflowId = "workflow-1" as WorkflowId;
const component = {
  artifacts: {
    createScope: "create-scope",
    attachWorkflow: "attach-workflow",
    closeScope: "close-scope",
    abandonScope: "abandon-scope",
  },
} as never;

describe("managed artifact workflows", () => {
  test("creates and privately binds one artifact scope when starting a workflow", async () => {
    const start = vi.fn(async () => workflowId);
    const manager = new ManagedWorkflowManager(
      { start } as never,
      component,
      "lifecycle-completion" as never,
    );
    const runMutation = vi.fn(async (fn) => (fn === "create-scope" ? scopeId : undefined));
    const ctx = { runMutation };

    await expect(
      manager.start(ctx as never, "workflow" as never, { jobId: "job-1" } as never),
    ).resolves.toBe(workflowId);

    expect(start).toHaveBeenCalledWith(
      ctx,
      "workflow",
      { jobId: "job-1" },
      {
        onComplete: "lifecycle-completion",
        context: { artifactScopeId: scopeId },
        startAsync: true,
      },
    );
    expect(runMutation).toHaveBeenNthCalledWith(1, "create-scope", {
      ttlMs: undefined,
    });
    expect(runMutation).toHaveBeenNthCalledWith(2, "attach-workflow", {
      scopeId,
      workflowId,
    });
  });

  test("closes the scope after successful workflow completion", async () => {
    const runMutation = vi.fn(async () => undefined);

    await settleManagedWorkflow({ runMutation }, component, {
      workflowId,
      result: { kind: "success", returnValue: null },
      context: {
        artifactScopeId: scopeId,
        completion: {
          fnHandle: "domain-completion",
          context: { jobId: "job-1" },
        },
      },
    });

    expect(runMutation).toHaveBeenNthCalledWith(1, "close-scope", { scopeId });
    expect(runMutation).toHaveBeenNthCalledWith(2, "domain-completion", {
      workflowId,
      result: { kind: "success", returnValue: null },
      context: { jobId: "job-1" },
    });
  });

  test("abandons the scope after workflow failure", async () => {
    const runMutation = vi.fn(async () => undefined);

    await settleManagedWorkflow({ runMutation }, component, {
      workflowId,
      result: { kind: "failed", error: "boom" },
      context: { artifactScopeId: scopeId },
    });

    expect(runMutation).toHaveBeenCalledOnce();
    expect(runMutation).toHaveBeenCalledWith("abandon-scope", { scopeId });
  });
});
