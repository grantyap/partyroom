import { describe, expect, test, vi } from "vitest";
import type { WorkflowId } from "@convex-dev/workflow";
import type { ActivityManager, ArtifactScopeId } from "./client";
import { ManagedWorkflowManager, settleManagedWorkflow } from "./managedWorkflow";

const scopeId = "scope-1" as ArtifactScopeId;
const workflowId = "workflow-1" as WorkflowId;

describe("managed artifact workflows", () => {
  test("creates and privately binds one artifact scope when starting a workflow", async () => {
    const createArtifactScope = vi.fn(async () => scopeId);
    const attachArtifactScopeToWorkflow = vi.fn(async () => undefined);
    const start = vi.fn(async () => workflowId);
    const manager = new ManagedWorkflowManager(
      { start } as never,
      { createArtifactScope, attachArtifactScopeToWorkflow } as never,
      "lifecycle-completion" as never,
    );

    await expect(
      manager.start({} as never, "workflow" as never, { jobId: "job-1" } as never),
    ).resolves.toBe(workflowId);

    expect(createArtifactScope).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(
      {},
      "workflow",
      { jobId: "job-1" },
      {
        onComplete: "lifecycle-completion",
        context: { artifactScopeId: scopeId },
        startAsync: true,
      },
    );
    expect(attachArtifactScopeToWorkflow).toHaveBeenCalledWith({}, scopeId, workflowId);
  });

  test("closes the scope after successful workflow completion", async () => {
    const closeArtifactScope = vi.fn(async () => undefined);
    const abandonArtifactScope = vi.fn(async () => undefined);
    const runMutation = vi.fn(async () => undefined);

    await settleManagedWorkflow(
      { runMutation },
      { closeArtifactScope, abandonArtifactScope } as unknown as ActivityManager,
      {
        workflowId,
        result: { kind: "success", returnValue: null },
        context: {
          artifactScopeId: scopeId,
          completion: {
            fnHandle: "domain-completion",
            context: { jobId: "job-1" },
          },
        },
      },
    );

    expect(closeArtifactScope).toHaveBeenCalledWith({ runMutation }, scopeId);
    expect(abandonArtifactScope).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith("domain-completion", {
      workflowId,
      result: { kind: "success", returnValue: null },
      context: { jobId: "job-1" },
    });
  });

  test("abandons the scope after workflow failure", async () => {
    const closeArtifactScope = vi.fn(async () => undefined);
    const abandonArtifactScope = vi.fn(async () => undefined);

    await settleManagedWorkflow(
      { runMutation: vi.fn() },
      { closeArtifactScope, abandonArtifactScope } as unknown as ActivityManager,
      {
        workflowId,
        result: { kind: "failed", error: "boom" },
        context: { artifactScopeId: scopeId },
      },
    );

    expect(abandonArtifactScope).toHaveBeenCalledWith(expect.anything(), scopeId);
    expect(closeArtifactScope).not.toHaveBeenCalled();
  });
});
