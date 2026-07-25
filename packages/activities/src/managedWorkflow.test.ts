import { describe, expect, test, vi } from "vitest";
import type { WorkflowId } from "@convex-dev/workflow";
import type { ActivityManager, ArtifactScopeId } from "./client";
import {
  artifactWorkflowResult,
  ManagedWorkflowManager,
  settleManagedWorkflow,
} from "./managedWorkflow";
import type { ArtifactId } from "./wire";

const scopeId = "scope-1" as ArtifactScopeId;
const workflowId = "workflow-1" as WorkflowId;
const finalArtifact = "artifact-final" as ArtifactId;

describe("managed artifact workflows", () => {
  test("creates and injects one artifact scope when starting a workflow", async () => {
    const createArtifactScope = vi.fn(async () => scopeId);
    const start = vi.fn(async () => workflowId);
    const manager = new ManagedWorkflowManager(
      { start } as never,
      { createArtifactScope } as never,
      "lifecycle-completion" as never,
    );

    await expect(
      manager.start({} as never, "workflow" as never, { jobId: "job-1" } as never, {
        startAsync: true,
      }),
    ).resolves.toEqual({ workflowId, artifactScopeId: scopeId });

    expect(createArtifactScope).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(
      {},
      "workflow",
      { jobId: "job-1", artifactScopeId: scopeId },
      {
        onComplete: "lifecycle-completion",
        context: { artifactScopeId: scopeId },
        startAsync: true,
      },
    );
  });

  test("adopts returned artifacts after successful workflow completion", async () => {
    const closeArtifactScope = vi.fn(async () => undefined);
    const abandonArtifactScope = vi.fn(async () => undefined);
    const runMutation = vi.fn(async () => undefined);

    await settleManagedWorkflow(
      { runMutation },
      { closeArtifactScope, abandonArtifactScope } as unknown as ActivityManager,
      {
        workflowId,
        result: {
          kind: "success",
          returnValue: artifactWorkflowResult([finalArtifact]),
        },
        context: {
          artifactScopeId: scopeId,
          completion: {
            fnHandle: "domain-completion",
            context: { jobId: "job-1" },
          },
        },
      },
    );

    expect(closeArtifactScope).toHaveBeenCalledWith({ runMutation }, scopeId, [finalArtifact]);
    expect(abandonArtifactScope).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith("domain-completion", {
      workflowId,
      result: {
        kind: "success",
        returnValue: { retainedArtifacts: [finalArtifact] },
      },
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

  test("does not close a successful scope without an artifact result", async () => {
    await expect(
      settleManagedWorkflow(
        { runMutation: vi.fn() },
        {
          closeArtifactScope: vi.fn(),
          abandonArtifactScope: vi.fn(),
        } as unknown as ActivityManager,
        {
          workflowId,
          result: { kind: "success", returnValue: null },
          context: { artifactScopeId: scopeId },
        },
      ),
    ).rejects.toThrow("did not return retainedArtifacts");
  });
});
