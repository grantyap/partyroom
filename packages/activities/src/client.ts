import type { WorkflowId } from "@convex-dev/workflow";
import type {
  FunctionHandle,
  FunctionReference,
  FunctionVisibility,
  GenericMutationCtx,
  GenericDataModel,
} from "convex/server";
import { createFunctionHandle } from "convex/server";
import type { Infer, Validator, Value } from "convex/values";
import type { ComponentApi } from "../component/_generated/component";
import { protocolVersion } from "../protocol";
import { artifactScopeForWorkflow, type ArtifactScopeId } from "./artifactLifecycle";
import type { ActivityWorkflowCompletionArgs } from "./activityCompletion";
import {
  wireValidator,
  type ArtifactId,
  type WireInfer,
  type WireSchema,
} from "./wire";

export type ActivityId = string & { readonly __activityId: unique symbol };
export type ActivityState = "scheduled" | "running" | "completed" | "failed" | "canceled";

/**
 * Retry policy applied by an activity worker.
 *
 * {@link defineActivity} supplies conservative defaults, so definitions only
 * need to override values that are part of their worker contract.
 */
export type RetryPolicy = {
  maximumAttempts: number;
  initialIntervalMs: number;
  backoffCoefficient: number;
  maximumIntervalMs: number;
  nonRetryableErrorTypes: string[];
};

/**
 * Declares where an activity runs and how long a worker may hold its lease.
 *
 * Reuse queue definitions across activities that share worker capacity. Use
 * `maxConcurrentActivities` only when the queue itself needs a hard cap.
 *
 * @see {@link defineQueue}
 * @see {@link defineActivity}
 */
export type QueueDefinition<Name extends string = string> = {
  readonly name: Name;
  readonly leaseDurationMs: number;
  readonly maxConcurrentActivities?: number;
};

type AnyValidator = Validator<any, any, any>;

/**
 * Immutable activity definition returned by {@link defineActivity}.
 *
 * Pass the definition directly to `activityStep`. Its type parameters keep the
 * queue, input, and output types connected without manual type arguments.
 *
 * @see {@link defineActivity}
 */
export type ActivityDefinition<
  Name extends string = string,
  Version extends number = number,
  InputValidator extends AnyValidator = AnyValidator,
  OutputValidator extends AnyValidator = AnyValidator,
  Queue extends QueueDefinition = QueueDefinition,
> = {
  readonly name: Name;
  readonly version: Version;
  readonly queue: Queue;
  readonly input: InputValidator;
  readonly inputSchema: WireSchema;
  readonly outputSchema: WireSchema;
  readonly output: OutputValidator;
  readonly startToCloseTimeoutMs: number;
  readonly scheduleToCloseTimeoutMs: number;
  readonly retryPolicy: RetryPolicy;
};

export type ActivityInput<Definition extends ActivityDefinition> = Infer<Definition["input"]>;
export type ActivityOutput<Definition extends ActivityDefinition> = Infer<Definition["output"]>;

const defaultRetryPolicy: RetryPolicy = {
  maximumAttempts: 3,
  initialIntervalMs: 1_000,
  backoffCoefficient: 2,
  maximumIntervalMs: 60_000,
  nonRetryableErrorTypes: [],
};

/**
 * Creates an immutable queue definition and preserves its name as a literal
 * type.
 *
 * @see {@link QueueDefinition}
 * @see {@link defineActivity}
 */
export function defineQueue<const Name extends string>(
  name: Name,
  options: Omit<QueueDefinition<Name>, "name">,
): QueueDefinition<Name> {
  return Object.freeze({ name, ...options });
}

/**
 * Creates an immutable activity definition and validates its wire schemas.
 *
 * Use this function instead of annotating an {@link ActivityDefinition} object.
 * It preserves literal names and versions and keeps input/output types inferred
 * from the schemas.
 *
 * Timeouts are required. Retries default to three attempts with exponential
 * backoff from 1 second to 60 seconds; override only the values that differ.
 * Increase `version` for an incompatible worker-facing change, not for a
 * workflow-only orchestration change.
 *
 * @see {@link defineQueue}
 * @see {@link activityStep}
 */
export function defineActivity<
  const Name extends string,
  const Version extends number,
  const InputSchema extends WireSchema,
  const OutputSchema extends WireSchema,
  Queue extends QueueDefinition,
>(config: {
  name: Name;
  /**
   * Bump when this activity's input, output, artifact contract, or observable
   * behavior changes incompatibly. Workflow-only orchestration changes do not
   * require an activity version bump.
   */
  version: Version;
  queue: Queue;
  input: InputSchema;
  output: OutputSchema;
  startToCloseTimeoutMs: number;
  scheduleToCloseTimeoutMs: number;
  retryPolicy?: Partial<RetryPolicy>;
}): ActivityDefinition<
  Name,
  Version,
  Validator<WireInfer<InputSchema>, "required", any>,
  Validator<WireInfer<OutputSchema>, "required", any>,
  Queue
> & {
  readonly inputSchema: InputSchema;
  readonly outputSchema: OutputSchema;
} {
  return Object.freeze({
    ...config,
    inputSchema: config.input,
    outputSchema: config.output,
    input: wireValidator(config.input),
    output: wireValidator(config.output),
    retryPolicy: {
      ...defaultRetryPolicy,
      ...config.retryPolicy,
      nonRetryableErrorTypes:
        config.retryPolicy?.nonRetryableErrorTypes ?? defaultRetryPolicy.nonRetryableErrorTypes,
    },
  });
}

export type ActivityCompletionResult<Output = Value> =
  | { kind: "success"; value: Output }
  | { kind: "failed"; errorType: string; errorMessage: string }
  | { kind: "canceled" };

export type ActivityCompletionArgs<Context = unknown, Output = Value> = {
  activityId: string;
  context: Context;
  result: ActivityCompletionResult<Output>;
};

type MutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
type QueryCtx = Pick<GenericMutationCtx<GenericDataModel>, "runQuery">;
type WorkflowMutationCtx = MutationCtx & QueryCtx;

type ScheduleOptions<Definition extends ActivityDefinition, Context> =
  | {
      onComplete: FunctionReference<
        "mutation",
        FunctionVisibility,
        ActivityCompletionArgs<Context, ActivityOutput<Definition>>
      >;
      context: Context;
    }
  | {
      onComplete?: undefined;
      context?: undefined;
    };

export class ActivityManager {
  constructor(
    private readonly component: ComponentApi,
    private readonly lifecycleCompletion: FunctionReference<
      "mutation",
      "internal",
      ActivityWorkflowCompletionArgs
    >,
  ) {}

  async schedule<Definition extends ActivityDefinition, Context = unknown>(
    ctx: WorkflowMutationCtx,
    workflowId: WorkflowId,
    definition: Definition,
    input: ActivityInput<Definition>,
    options?: ScheduleOptions<Definition, Context>,
  ): Promise<ActivityId> {
    const artifactScopeId = await artifactScopeForWorkflow(this.component, ctx, workflowId);
    return await this.scheduleInScope(ctx, workflowId, artifactScopeId, definition, input, options);
  }

  private async scheduleInScope<Definition extends ActivityDefinition, Context>(
    ctx: MutationCtx,
    workflowId: WorkflowId,
    artifactScopeId: ArtifactScopeId,
    definition: Definition,
    input: ActivityInput<Definition>,
    options?: ScheduleOptions<Definition, Context>,
  ): Promise<ActivityId> {
    const domainCompletion = options?.onComplete
      ? {
          fnHandle: (await createFunctionHandle(options.onComplete)) as FunctionHandle<"mutation">,
          context: options.context,
        }
      : undefined;
    const completion = {
      fnHandle: (await createFunctionHandle(
        this.lifecycleCompletion,
      )) as FunctionHandle<"mutation">,
      context: {
        workflowId,
        ...(domainCompletion ? { completion: domainCompletion } : {}),
      },
    };
    const activityId = await ctx.runMutation(this.component.activities.schedule, {
      activityType: definition.name,
      activityVersion: definition.version,
      taskQueue: definition.queue.name,
      queue: {
        leaseDurationMs: definition.queue.leaseDurationMs,
        maxConcurrentActivities: definition.queue.maxConcurrentActivities,
      },
      input,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      artifactScopeId,
      completion,
      retryPolicy: definition.retryPolicy,
      startToCloseTimeoutMs: definition.startToCloseTimeoutMs,
      scheduleToCloseTimeoutMs: definition.scheduleToCloseTimeoutMs,
    });
    return activityId as ActivityId;
  }

  async validateProduced(ctx: QueryCtx, workflowId: string, artifactId: string, slot: string) {
    await ctx.runQuery(this.component.artifacts.validateProduced, {
      workflowId,
      artifactId: artifactId as any,
      slot,
    });
  }

  async publishArtifacts(
    ctx: MutationCtx,
    workflowId: string,
    owner: string,
    artifacts: Readonly<Record<string, string>>,
  ) {
    await ctx.runMutation(this.component.artifacts.adopt, {
      workflowId,
      owner,
      artifacts: Object.entries(artifacts).map(
        ([slot, artifactId]) => ({ artifactId, slot }),
      ) as any,
    });
  }

  async deleteArtifact(ctx: MutationCtx, artifactId: ArtifactId, owner: string) {
    return await ctx.runMutation(this.component.artifacts.deleteArtifact, {
      artifactId: artifactId as any,
      owner,
    });
  }

  async getArtifactUrl(ctx: QueryCtx, artifactId: ArtifactId) {
    return await ctx.runQuery(this.component.artifacts.getUrl, {
      artifactId: artifactId as any,
    });
  }
}

export { protocolVersion };
export {
  activityStep,
  ManagedWorkflowManager,
  workflowStep,
  type ManagedWorkflowCtx,
  type ManagedStepOperation,
} from "./managedWorkflow";
export { wire, type ArtifactDisposition, type ArtifactId, type WireSchema } from "./wire";
