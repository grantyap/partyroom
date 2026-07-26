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
  type ReturnValueForOptionalValidator,
} from "convex/server";
import { v, type ObjectType, type PropertyValidators, type Validator } from "convex/values";
import type { ComponentApi } from "../component/_generated/component";
import {
  abandonArtifactScope,
  attachArtifactScopeToWorkflow,
  closeArtifactScope,
  createArtifactScope,
  type ArtifactScopeId,
} from "./artifactLifecycle";

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
};

export class ManagedWorkflowManager {
  constructor(
    private readonly workflows: WorkflowManager,
    private readonly component: ComponentApi,
    private readonly lifecycleCompletion: FunctionReference<"mutation", "internal">,
  ) {}

  /**
   * Defines durable orchestration. Changing only the workflow graph does not
   * require a worker protocol or activity version bump. Bump an activity's
   * version when its worker-facing contract changes, and bump protocolVersion
   * when the shared backend-to-worker transport changes incompatibly.
   */
  define<
    const Args extends PropertyValidators,
    Returns extends Validator<unknown, "required", string> | void = void,
  >(config: {
    args: Args;
    returns?: Returns;
    workpoolOptions?: Parameters<WorkflowManager["define"]>[0]["workpoolOptions"];
  }): {
    handler(
      fn: (
        step: WorkflowCtx,
        args: ObjectType<Args>,
      ) => Promise<ReturnValueForOptionalValidator<Returns>>,
    ): RegisteredMutation<"internal", WorkflowArgs<Args>, WorkflowId>;
  } {
    const definition = this.workflows.define({
      args: config.args,
      returns: config.returns,
      workpoolOptions: config.workpoolOptions,
    });
    return definition;
  }

  async start<
    Context = unknown,
    F extends FunctionReference<"mutation", "internal"> = FunctionReference<"mutation", "internal">,
  >(
    ctx: WorkflowStartCtx,
    workflow: F,
    args: FunctionArgs<F>["args"],
    options?: StartOptions<Context>,
  ): Promise<WorkflowId> {
    const artifactScopeId = await createArtifactScope(this.component, ctx, {
      ttlMs: options?.artifactTtlMs,
    });
    const completion = options?.onComplete
      ? {
          fnHandle: await createFunctionHandle(options.onComplete),
          context: options.context,
        }
      : undefined;
    const workflowId = await this.workflows.start(ctx, workflow, args, {
      onComplete: this.lifecycleCompletion,
      context: {
        artifactScopeId,
        ...(completion ? { completion } : {}),
      },
      // The scope must be attached before the workflow can schedule activities.
      startAsync: true,
    });
    await attachArtifactScopeToWorkflow(this.component, ctx, artifactScopeId, workflowId);
    return workflowId;
  }
}

export async function settleManagedWorkflow(
  ctx: MutationCtx,
  activities: ComponentApi,
  args: ManagedWorkflowCompletionArgs,
) {
  const artifactScopeId = args.context.artifactScopeId as ArtifactScopeId;
  if (args.result.kind === "success") {
    await closeArtifactScope(activities, ctx, artifactScopeId);
  } else {
    await abandonArtifactScope(activities, ctx, artifactScopeId);
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
