import type { WorkflowId } from "@convex-dev/workflow";
import type { GenericDataModel, GenericMutationCtx } from "convex/server";
import type { ComponentApi } from "../component/_generated/component";

export type ArtifactScopeId = string & { readonly __artifactScopeId: unique symbol };

type MutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
type WorkflowMutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation" | "runQuery">;

export async function createArtifactScope(
  component: ComponentApi,
  ctx: MutationCtx,
  options?: { ttlMs?: number },
) {
  return (await ctx.runMutation(component.artifacts.createScope, {
    ttlMs: options?.ttlMs,
  })) as ArtifactScopeId;
}

export async function attachArtifactScopeToWorkflow(
  component: ComponentApi,
  ctx: MutationCtx,
  artifactScopeId: ArtifactScopeId,
  workflowId: WorkflowId,
) {
  await ctx.runMutation(component.artifacts.attachWorkflow, {
    scopeId: artifactScopeId,
    workflowId,
  });
}

export async function artifactScopeForWorkflow(
  component: ComponentApi,
  ctx: WorkflowMutationCtx,
  workflowId: WorkflowId,
) {
  const artifactScopeId = await ctx.runQuery(component.artifacts.getScopeForWorkflow, {
    workflowId,
  });
  if (!artifactScopeId) {
    throw new Error(`Workflow ${workflowId} has no managed artifact scope`);
  }
  return artifactScopeId as ArtifactScopeId;
}

export async function closeArtifactScope(
  component: ComponentApi,
  ctx: MutationCtx,
  artifactScopeId: ArtifactScopeId,
) {
  await ctx.runMutation(component.artifacts.closeScope, {
    scopeId: artifactScopeId,
  });
}

export async function abandonArtifactScope(
  component: ComponentApi,
  ctx: MutationCtx,
  artifactScopeId: ArtifactScopeId,
) {
  await ctx.runMutation(component.artifacts.abandonScope, {
    scopeId: artifactScopeId,
  });
}
