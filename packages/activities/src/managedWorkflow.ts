import {
  WorkflowManager,
  type WorkflowArgs,
  type WorkflowCtx,
  type WorkflowId,
} from "@convex-dev/workflow";
import {
  createFunctionHandle,
  type FunctionArgs,
  type FunctionHandle,
  type FunctionReference,
  type FunctionVisibility,
  type GenericDataModel,
  type GenericMutationCtx,
  type RegisteredMutation,
} from "convex/server";
import { v, type ObjectType, type PropertyValidators } from "convex/values";
import type { ActivityManager, ArtifactScopeId } from "./client";
import type { ArtifactId } from "./wire";

export const artifactWorkflowResultValidator = v.object({
  retainedArtifacts: v.array(v.string()),
});

export type ArtifactWorkflowResult = {
  retainedArtifacts: ArtifactId[];
};

export function artifactWorkflowResult(
  retainedArtifacts: readonly ArtifactId[],
): ArtifactWorkflowResult {
  return { retainedArtifacts: [...retainedArtifacts] };
}

export const managedWorkflowCompletionContextValidator = v.object({
  artifactScopeId: v.string(),
  completion: v.optional(
    v.object({
      fnHandle: v.string(),
      context: v.optional(v.any()),
    }),
  ),
});

type WorkflowRunResult =
  | { kind: "success"; returnValue: unknown }
  | { kind: "failed"; error: string }
  | { kind: "canceled" };

export type ManagedWorkflowCompletionArgs = {
  workflowId: WorkflowId;
  result: WorkflowRunResult;
  context: {
    artifactScopeId: string;
    completion?: {
      fnHandle: string;
      context?: unknown;
    };
  };
};

type MutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
type WorkflowStartCtx = GenericMutationCtx<GenericDataModel>;

type CompletionOptions<Context> =
  | {
      onComplete: FunctionReference<
        "mutation",
        FunctionVisibility,
        {
          workflowId: string;
          result: WorkflowRunResult;
          context: Context;
        }
      >;
      context: Context;
    }
  | {
      onComplete?: undefined;
      context?: undefined;
    };

type StartOptions<Context> = CompletionOptions<Context> & {
  artifactTtlMs?: number;
  startAsync?: boolean;
};

type ManagedWorkflowArgs<F extends FunctionReference<"mutation", "internal">> =
  FunctionArgs<F>["args"] extends infer Args extends Record<string, unknown>
    ? Omit<Args, "artifactScopeId">
    : never;

export class ManagedWorkflowManager {
  constructor(
    private readonly workflows: WorkflowManager,
    private readonly activities: ActivityManager,
    private readonly lifecycleCompletion: FunctionReference<"mutation", "internal">,
  ) {}

  define<const Args extends PropertyValidators>(config: {
    args: Args;
    workpoolOptions?: Parameters<WorkflowManager["define"]>[0]["workpoolOptions"];
  }): {
    handler(
      fn: (
        step: WorkflowCtx,
        args: ObjectType<Args> & { artifactScopeId: ArtifactScopeId },
      ) => Promise<ArtifactWorkflowResult>,
    ): RegisteredMutation<
      "internal",
      WorkflowArgs<Args & { artifactScopeId: ReturnType<typeof v.string> }>,
      WorkflowId
    >;
  } {
    const definition = this.workflows.define({
      args: {
        ...config.args,
        artifactScopeId: v.string(),
      },
      returns: artifactWorkflowResultValidator,
      workpoolOptions: config.workpoolOptions,
    }) as {
      handler(
        fn: (
          step: WorkflowCtx,
          args: ObjectType<Args> & { artifactScopeId: string },
        ) => Promise<ArtifactWorkflowResult>,
      ): RegisteredMutation<
        "internal",
        WorkflowArgs<Args & { artifactScopeId: ReturnType<typeof v.string> }>,
        WorkflowId
      >;
    };
    return {
      handler: (fn) =>
        definition.handler(
          fn as (
            step: WorkflowCtx,
            args: ObjectType<Args> & { artifactScopeId: string },
          ) => Promise<ArtifactWorkflowResult>,
        ),
    };
  }

  async start<
    Context = unknown,
    F extends FunctionReference<"mutation", "internal"> = FunctionReference<"mutation", "internal">,
  >(
    ctx: WorkflowStartCtx,
    workflow: F,
    args: ManagedWorkflowArgs<F>,
    options?: StartOptions<Context>,
  ): Promise<{ workflowId: WorkflowId; artifactScopeId: ArtifactScopeId }> {
    const artifactScopeId = await this.activities.createArtifactScope(ctx, {
      ttlMs: options?.artifactTtlMs,
    });
    const completion = options?.onComplete
      ? {
          fnHandle: await createFunctionHandle(options.onComplete),
          context: options.context,
        }
      : undefined;
    const workflowId = await this.workflows.start(
      ctx,
      workflow,
      { ...args, artifactScopeId } as FunctionArgs<F>["args"],
      {
        onComplete: this.lifecycleCompletion,
        context: {
          artifactScopeId,
          ...(completion ? { completion } : {}),
        },
        startAsync: options?.startAsync,
      },
    );
    return { workflowId, artifactScopeId };
  }
}

export async function settleManagedWorkflow(
  ctx: MutationCtx,
  activities: ActivityManager,
  args: ManagedWorkflowCompletionArgs,
) {
  const artifactScopeId = args.context.artifactScopeId as ArtifactScopeId;
  if (args.result.kind === "success") {
    const returnValue = args.result.returnValue;
    if (
      !returnValue ||
      typeof returnValue !== "object" ||
      !Array.isArray((returnValue as { retainedArtifacts?: unknown }).retainedArtifacts) ||
      !(returnValue as { retainedArtifacts: unknown[] }).retainedArtifacts.every(
        (artifactId) => typeof artifactId === "string",
      )
    ) {
      throw new Error("Managed workflow did not return retainedArtifacts");
    }
    await activities.closeArtifactScope(
      ctx,
      artifactScopeId,
      (returnValue as { retainedArtifacts: ArtifactId[] }).retainedArtifacts,
    );
  } else {
    await activities.abandonArtifactScope(ctx, artifactScopeId);
  }

  const completion = args.context.completion;
  if (completion) {
    await ctx.runMutation(completion.fnHandle as FunctionHandle<"mutation">, {
      workflowId: args.workflowId,
      result: args.result,
      context: completion.context,
    });
  }
}
