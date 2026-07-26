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
import {
  wireArtifactDefinitions,
  wireValidator,
  type ArtifactDisposition,
  type ArtifactId,
  type WireArtifactDefinitions,
  type WireInfer,
  type WireSchema,
} from "./wire";

export type ActivityId = string & { readonly __activityId: unique symbol };
export type ActivityState = "scheduled" | "running" | "completed" | "failed" | "canceled";

export type RetryPolicy = {
  maximumAttempts: number;
  initialIntervalMs: number;
  backoffCoefficient: number;
  maximumIntervalMs: number;
  nonRetryableErrorTypes: string[];
};

export type QueueDefinition<Name extends string = string> = {
  readonly name: Name;
  readonly leaseDurationMs: number;
  readonly maxConcurrentActivities?: number;
};

type AnyValidator = Validator<any, any, any>;

export type ArtifactDefinitions = Readonly<
  Record<string, { readonly disposition: ArtifactDisposition }>
>;

export type ActivityDefinition<
  Name extends string = string,
  Version extends number = number,
  InputValidator extends AnyValidator = AnyValidator,
  OutputValidator extends AnyValidator = AnyValidator,
  Queue extends QueueDefinition = QueueDefinition,
  Artifacts extends ArtifactDefinitions = any,
> = {
  readonly name: Name;
  readonly version: Version;
  readonly queue: Queue;
  readonly input: InputValidator;
  readonly output: OutputValidator;
  readonly startToCloseTimeoutMs: number;
  readonly scheduleToCloseTimeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly artifacts: Artifacts;
  readonly artifactSlots: readonly (keyof Artifacts & string)[];
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

export function defineQueue<const Name extends string>(
  name: Name,
  options: Omit<QueueDefinition<Name>, "name">,
): QueueDefinition<Name> {
  return Object.freeze({ name, ...options });
}

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
  Queue,
  WireArtifactDefinitions<OutputSchema>
> & {
  readonly inputSchema: InputSchema;
  readonly outputSchema: OutputSchema;
} {
  const artifacts = wireArtifactDefinitions(config.output);
  return Object.freeze({
    ...config,
    inputSchema: config.input,
    outputSchema: config.output,
    input: wireValidator(config.input),
    output: wireValidator(config.output),
    artifacts,
    artifactSlots: Object.keys(artifacts) as (keyof WireArtifactDefinitions<OutputSchema> &
      string)[],
    retryPolicy: {
      ...defaultRetryPolicy,
      ...config.retryPolicy,
      nonRetryableErrorTypes:
        config.retryPolicy?.nonRetryableErrorTypes ?? defaultRetryPolicy.nonRetryableErrorTypes,
    },
  });
}

export function defineActivityRegistry<
  const Queues extends Record<string, QueueDefinition>,
  const Activities extends Record<string, ActivityDefinition>,
>(registry: { queues: Queues; activities: Activities }) {
  return Object.freeze(registry);
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

type ScheduleOptions<Definition extends ActivityDefinition, Context> = {
  onComplete?: FunctionReference<
    "mutation",
    FunctionVisibility,
    ActivityCompletionArgs<Context, ActivityOutput<Definition>>
  >;
  context?: Context;
};

export class ActivityManager {
  constructor(private readonly component: ComponentApi) {}

  async schedule<Definition extends ActivityDefinition, Context = unknown>(
    ctx: WorkflowMutationCtx,
    workflowId: WorkflowId,
    definition: Definition,
    input: ActivityInput<Definition>,
    options?: ScheduleOptions<Definition, Context>,
  ): Promise<ActivityId> {
    const artifactScopeId = await artifactScopeForWorkflow(this.component, ctx, workflowId);
    return await this.scheduleInScope(ctx, artifactScopeId, definition, input, options);
  }

  private async scheduleInScope<Definition extends ActivityDefinition, Context>(
    ctx: MutationCtx,
    artifactScopeId: ArtifactScopeId,
    definition: Definition,
    input: ActivityInput<Definition>,
    options?: ScheduleOptions<Definition, Context>,
  ): Promise<ActivityId> {
    const completion = options?.onComplete
      ? {
          fnHandle: (await createFunctionHandle(options.onComplete)) as FunctionHandle<"mutation">,
          context: options.context,
        }
      : undefined;
    const activityId = await ctx.runMutation(this.component.activities.schedule, {
      activityType: definition.name,
      activityVersion: definition.version,
      taskQueue: definition.queue.name,
      queue: {
        leaseDurationMs: definition.queue.leaseDurationMs,
        maxConcurrentActivities: definition.queue.maxConcurrentActivities,
      },
      input,
      artifactScopeId,
      artifactSlots: [...definition.artifactSlots],
      artifactDefinitions: Object.entries(definition.artifacts as ArtifactDefinitions).map(
        ([slot, artifact]) => ({
          slot,
          disposition: artifact.disposition,
        }),
      ),
      completion,
      retryPolicy: definition.retryPolicy,
      startToCloseTimeoutMs: definition.startToCloseTimeoutMs,
      scheduleToCloseTimeoutMs: definition.scheduleToCloseTimeoutMs,
    });
    return activityId as ActivityId;
  }

  async deleteArtifact(ctx: MutationCtx, artifactId: ArtifactId) {
    return await ctx.runMutation(this.component.artifacts.deleteArtifact, {
      artifactId: artifactId as any,
    });
  }

  async getArtifactUrl(ctx: QueryCtx, artifactId: ArtifactId) {
    return await ctx.runQuery(this.component.artifacts.getUrl, {
      artifactId: artifactId as any,
    });
  }

  async cancel(ctx: MutationCtx, activityId: ActivityId) {
    await ctx.runMutation(this.component.activities.requestCancel, {
      activityId,
    });
  }
}

export type WorkerActivityDefinition = { name: string; version: number };

export type ClaimRequest = {
  protocolVersion: typeof protocolVersion;
  taskQueue: string;
  workerId: string;
  supportedActivities: WorkerActivityDefinition[];
};

export type ClaimedActivity = {
  protocolVersion: typeof protocolVersion;
  activityId: string;
  activityType: string;
  activityVersion: number;
  taskQueue: string;
  attempt: number;
  leaseToken: string;
  leaseExpiresAt: number;
  attemptDeadline: number;
  scheduleDeadline: number;
  input: Value;
};

export type RenewRequest = {
  activityId: string;
  attempt: number;
  leaseToken: string;
  progress?: number;
  progressMessage?: string;
  heartbeatDetails?: Value;
};

export type CompleteRequest = {
  activityId: string;
  attempt: number;
  leaseToken: string;
  requestId: string;
  value: Value;
};

export type FailRequest = {
  activityId: string;
  attempt: number;
  leaseToken: string;
  requestId: string;
  errorType: string;
  errorMessage: string;
  nonRetryable?: boolean;
};

export type CancelRequest = {
  activityId: string;
  attempt: number;
  leaseToken: string;
  requestId: string;
};

export type ActivityWorkflowContext = {
  workflowId: WorkflowId;
  eventName: string;
};

export { protocolVersion };
export { ManagedWorkflowManager } from "./managedWorkflow";
export { wire, type ArtifactDisposition, type ArtifactId, type WireSchema } from "./wire";
