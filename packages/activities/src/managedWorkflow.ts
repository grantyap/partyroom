import {
  WorkflowManager,
  type RunOptions,
  type WorkflowArgs,
  type WorkflowCtx,
  type WorkflowId,
} from "@convex-dev/workflow";
import {
  createFunctionHandle,
  type FunctionArgs,
  type FunctionHandle,
  type FunctionReference,
  type FunctionReturnType,
  type FunctionVisibility,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
  type RegisteredMutation,
  type ReturnValueForOptionalValidator,
} from "convex/server";
import { v, type ObjectType, type PropertyValidators, type Validator } from "convex/values";
import type { ComponentApi } from "../component/_generated/component";
import type { ActivityDefinition, ActivityInput, ActivityOutput, ActivityManager } from "./client";
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

type InputBuilder = FunctionReference<"query", FunctionVisibility>;
type StructuredOperationType = "query" | "mutation" | "action" | "workflow";
type StructuredTarget<Type extends StructuredOperationType> = Type extends "query"
  ? FunctionReference<"query", FunctionVisibility>
  : Type extends "action"
    ? FunctionReference<"action", FunctionVisibility>
    : Type extends "workflow"
      ? FunctionReference<"mutation", "internal">
      : FunctionReference<"mutation", FunctionVisibility>;
type StructuredRunOptions<Type extends StructuredOperationType> = Omit<RunOptions, "name"> &
  (Type extends "action"
    ? {
        retry?:
          | boolean
          | {
              maxAttempts: number;
              initialBackoffMs: number;
              base: number;
            };
      }
    : unknown) &
  (Type extends "query" | "mutation"
    ? {
        inline?: boolean;
      }
    : unknown);

type StructuredOperationOptions<
  Type extends StructuredOperationType = StructuredOperationType,
  Target extends StructuredTarget<Type> = StructuredTarget<Type>,
> = {
  readonly kind: "workflowOperation";
  readonly operation: Type;
  readonly target: Target;
  readonly runOptions: StructuredRunOptions<Type>;
};

type ActivityStepDefinition<
  Definition extends ActivityDefinition = ActivityDefinition,
  Builder extends InputBuilder | undefined = InputBuilder | undefined,
> = {
  readonly kind: "activity";
  readonly activity: Definition;
  readonly input?: Builder;
  readonly label?: string;
  readonly order?: number;
};

type WorkflowStepDefinition<
  Type extends StructuredOperationType = StructuredOperationType,
  Target extends StructuredTarget<Type> = StructuredTarget<Type>,
> = {
  readonly kind: "workflow";
  readonly operation: Type;
  readonly target: Target;
  readonly runOptions?: StructuredRunOptions<Type>;
  readonly label?: string;
  readonly order?: number;
};

type ManualWorkflowStepDefinition = {
  readonly kind: "manualWorkflow";
  readonly label?: string;
  readonly order?: number;
};

type AnyStepDefinition =
  | ActivityStepDefinition
  | WorkflowStepDefinition
  | ManualWorkflowStepDefinition;
type StepDefinitions = Readonly<Record<string, AnyStepDefinition>>;

/**
 * Creates reusable options for a registered Convex query used by
 * {@link workflowStep}.
 *
 * Query arguments and results stay inferred from `query`. Execution options
 * belong here so retry/scheduling policy can be shared independently from a
 * workflow's consumer-facing label and order.
 *
 * @see {@link mutationOptions}
 * @see {@link actionOptions}
 * @see {@link workflowOptions}
 * @see {@link workflowStep}
 */
export function queryOptions<Target extends StructuredTarget<"query">>(
  config: {
    query: Target;
  } & StructuredRunOptions<"query">,
): StructuredOperationOptions<"query", Target> {
  const { query, ...runOptions } = config;
  return Object.freeze({
    kind: "workflowOperation",
    operation: "query",
    target: query,
    runOptions,
  });
}

/**
 * Creates reusable options for a registered Convex mutation used by
 * {@link workflowStep}.
 *
 * Mutation arguments and results stay inferred from `mutation`. Put execution
 * behavior such as `inline` here; keep labels and display order on the
 * consuming workflow step.
 *
 * @see {@link queryOptions}
 * @see {@link actionOptions}
 * @see {@link workflowOptions}
 * @see {@link workflowStep}
 */
export function mutationOptions<Target extends StructuredTarget<"mutation">>(
  config: {
    mutation: Target;
  } & StructuredRunOptions<"mutation">,
): StructuredOperationOptions<"mutation", Target> {
  const { mutation, ...runOptions } = config;
  return Object.freeze({
    kind: "workflowOperation",
    operation: "mutation",
    target: mutation,
    runOptions,
  });
}

/**
 * Creates reusable options for a registered Convex action used by
 * {@link workflowStep}.
 *
 * Action arguments and results stay inferred from `action`. Retry and
 * scheduling behavior belong here so multiple workflows can reuse one
 * execution policy without duplicating configuration.
 *
 * @see {@link queryOptions}
 * @see {@link mutationOptions}
 * @see {@link workflowOptions}
 * @see {@link workflowStep}
 */
export function actionOptions<Target extends StructuredTarget<"action">>(
  config: {
    action: Target;
  } & StructuredRunOptions<"action">,
): StructuredOperationOptions<"action", Target> {
  const { action, ...runOptions } = config;
  return Object.freeze({
    kind: "workflowOperation",
    operation: "action",
    target: action,
    runOptions,
  });
}

/**
 * Creates reusable options for a registered child workflow used by
 * {@link workflowStep}.
 *
 * Choose this when one consumer-visible step needs several durable operations.
 * The child workflow owns that sequence while its parent retains one
 * structured, safely parallelizable step boundary.
 *
 * @see {@link queryOptions}
 * @see {@link mutationOptions}
 * @see {@link actionOptions}
 * @see {@link workflowStep}
 * @see {@link manualWorkflowStep}
 */
export function workflowOptions<Target extends StructuredTarget<"workflow">>(
  config: {
    workflow: Target;
  } & StructuredRunOptions<"workflow">,
): StructuredOperationOptions<"workflow", Target> {
  const { workflow, ...runOptions } = config;
  return Object.freeze({
    kind: "workflowOperation",
    operation: "workflow",
    target: workflow,
    runOptions,
  });
}

/**
 * Declares a consumer-visible workflow step backed by an external activity.
 *
 * Choose an activity step when the work has a {@link ActivityDefinition} and
 * runs through an activity worker. Calling its bound `run(input)` method
 * automatically schedules the activity, reports its queue and worker progress,
 * waits for completion, validates the output, and preserves the activity's
 * inferred input and output types.
 *
 * When workflow/domain arguments do not already match the activity input,
 * provide a typed Convex query through `options.input`. The bound `run()`
 * method will accept that query's arguments without `workflowId`; the runtime
 * injects the current workflow ID, executes the builder, validates its declared
 * return type against the activity input, and schedules the resulting value.
 *
 * For work represented by a registered Convex operation or child workflow,
 * use {@link workflowStep}. For a small inline sequence that must be awaited
 * immediately, use {@link manualWorkflowStep}.
 *
 * @see {@link workflowStep}
 * @see {@link manualWorkflowStep}
 * @see {@link ManagedWorkflowManager.define}
 */
export function activityStep<Definition extends ActivityDefinition>(
  activity: Definition,
  options?: { input?: never; label?: string; order?: number },
): ActivityStepDefinition<Definition, undefined>;
export function activityStep<Definition extends ActivityDefinition, Builder extends InputBuilder>(
  activity: Definition,
  options: {
    input: Builder;
    label?: string;
    order?: number;
  } & (FunctionArgs<Builder> extends { workflowId: string }
    ? FunctionReturnType<Builder> extends ActivityInput<Definition>
      ? unknown
      : {
          /**
           * The input builder must return the activity's declared input type.
           */
          readonly __activityInputBuilderReturnTypeMismatch: never;
        }
    : {
        /**
         * The input builder must accept a workflowId, which is injected by the
         * managed workflow runtime.
         */
        readonly __activityInputBuilderWorkflowIdRequired: never;
      }),
): ActivityStepDefinition<Definition, Builder>;
export function activityStep<
  Definition extends ActivityDefinition,
  Builder extends InputBuilder | undefined,
>(
  activity: Definition,
  options?: { input?: Builder; label?: string; order?: number },
): ActivityStepDefinition<Definition, Builder> {
  return Object.freeze({
    kind: "activity",
    activity,
    input: options?.input,
    label: options?.label,
    order: options?.order,
  });
}

/**
 * Declares a structured workflow step backed by one registered Convex
 * operation or child workflow.
 *
 * Prefer this for nearly all workflow-managed work. The operation forms one
 * durable journal boundary, can safely participate in `step.parallel()`, and
 * exposes inferred argument and return types. If a step requires multiple
 * durable operations, extract them into a child workflow and reference that
 * workflow here. Construct the operation with {@link queryOptions},
 * {@link mutationOptions}, {@link actionOptions}, or {@link workflowOptions};
 * keep reusable execution policy there and consumer-facing metadata here.
 *
 * For a small, strictly sequential sequence that is tightly coupled to its
 * parent workflow, use {@link manualWorkflowStep}.
 *
 * If the work is implemented by an activity worker, use {@link activityStep}
 * so scheduling, worker progress, output validation, and input/output type
 * inference are handled automatically.
 *
 * @see {@link manualWorkflowStep}
 * @see {@link activityStep}
 * @see {@link queryOptions}
 * @see {@link mutationOptions}
 * @see {@link actionOptions}
 * @see {@link workflowOptions}
 * @see {@link ManagedWorkflowManager.define}
 */
export function workflowStep<
  const Type extends StructuredOperationType,
  Target extends StructuredTarget<Type>,
>(
  operation: StructuredOperationOptions<Type, Target>,
  options?: {
    label?: string;
    order?: number;
  },
): WorkflowStepDefinition<Type, Target> {
  return Object.freeze({
    kind: "workflow",
    operation: operation.operation,
    target: operation.target,
    runOptions: operation.runOptions,
    label: options?.label,
    order: options?.order,
  });
}

/**
 * Declares an inline, manually orchestrated workflow progress step.
 *
 * Use this only for a small parent-specific sequence of queries, mutations,
 * actions, or event waits that does not justify a registered child workflow.
 * Its bound `run(callback)` call must be awaited immediately and must not be
 * started concurrently or joined later, because the callback may append
 * multiple journal entries whose replay order must remain deterministic.
 *
 * Prefer {@link workflowStep} whenever the work can be represented by one
 * registered operation or child workflow, especially when it may run in
 * parallel, be reused, or grow over time.
 *
 * @see {@link workflowStep}
 * @see {@link activityStep}
 * @see {@link ManagedWorkflowManager.define}
 */
export function manualWorkflowStep(options?: {
  label?: string;
  order?: number;
}): ManualWorkflowStepDefinition {
  return Object.freeze({
    kind: "manualWorkflow",
    label: options?.label,
    order: options?.order,
  });
}

type BoundStep = {
  /**
   * Marks a declared branch as intentionally skipped.
   *
   * Await this in the same control-flow position where `run()` would have
   * occurred so progress cannot remain pending.
   */
  skip(message?: string): Promise<void>;
};

type ManagedOperationPlan<Result> = {
  start(): Promise<void>;
  execute(): Promise<Result>;
  finish(result: PromiseSettledResult<Result>): Promise<void>;
};

const managedOperation = Symbol("managedWorkflowOperation");

/**
 * Opaque, single-use operation returned by a structured step's `run()` method.
 *
 * Await it immediately or pass it directly to
 * {@link ManagedWorkflowCtx.parallel}; do not store or reuse it.
 */
export type ManagedStepOperation<Result> = PromiseLike<Result> & {
  readonly [managedOperation]: () => ManagedOperationPlan<Result>;
};

type ManagedOperationResult<Operation> =
  Operation extends ManagedStepOperation<infer Result> ? Result : never;

class ManagedOperationCoordinator {
  private active = false;

  operation<Result>(createPlan: () => ManagedOperationPlan<Result>): ManagedStepOperation<Result> {
    let consumed = false;
    const takePlan = () => {
      if (consumed) throw new Error("Managed step operation has already been awaited");
      consumed = true;
      return createPlan();
    };
    const thisCoordinator = this;
    return {
      [managedOperation]: takePlan,
      then<TResult1 = Result, TResult2 = never>(
        onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> {
        return thisCoordinator
          .runPlans([takePlan()])
          .then(([result]) => result as Result)
          .then(onfulfilled ?? undefined, onrejected ?? undefined);
      },
    };
  }

  async parallel<const Operations extends Readonly<Record<string, ManagedStepOperation<unknown>>>>(
    operations: Operations,
  ): Promise<{ [Key in keyof Operations]: ManagedOperationResult<Operations[Key]> }> {
    const entries = Object.entries(operations);
    const results = await this.runPlans(
      entries.map(([, operation]) => operation[managedOperation]()),
    );
    return Object.fromEntries(entries.map(([key], index) => [key, results[index]])) as {
      [Key in keyof Operations]: ManagedOperationResult<Operations[Key]>;
    };
  }

  async exclusive<Result>(createPlan: () => ManagedOperationPlan<Result>): Promise<Result> {
    return (await this.runPlans([createPlan()]))[0] as Result;
  }

  private async runPlans(plans: ManagedOperationPlan<unknown>[]) {
    if (this.active) {
      throw new Error(
        "A managed workflow step is already running. Await it immediately, or pass structured steps to step.parallel().",
      );
    }
    this.active = true;
    try {
      const starts = await Promise.allSettled(plans.map(async (plan) => await plan.start()));
      const startFailure = starts.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (startFailure) throw startFailure.reason;
      const settled = await Promise.allSettled(plans.map(async (plan) => await plan.execute()));
      await Promise.all(plans.map(async (plan, index) => await plan.finish(settled[index]!)));
      const failure = settled.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure) throw failure.reason;
      return settled.map((result) => (result as PromiseFulfilledResult<unknown>).value);
    } finally {
      this.active = false;
    }
  }
}

type BoundActivityStep<
  Definition extends ActivityDefinition,
  Builder extends InputBuilder | undefined,
> = BoundStep & {
  /**
   * Builds, schedules, and awaits the activity with fully inferred arguments
   * and output. Await immediately, or pass the returned operation directly to
   * {@link ManagedWorkflowCtx.parallel}.
   */
  run(
    input: Builder extends InputBuilder
      ? Omit<FunctionArgs<Builder>, "workflowId">
      : ActivityInput<Definition>,
  ): ManagedStepOperation<ActivityOutput<Definition>>;
};

type StructuredStepArgs<
  Type extends StructuredOperationType,
  Target extends StructuredTarget<Type>,
> = Type extends "workflow" ? FunctionArgs<Target>["args"] : FunctionArgs<Target>;

type BoundWorkflowStep<
  Type extends StructuredOperationType,
  Target extends StructuredTarget<Type>,
> = BoundStep & {
  /**
   * Runs one declared Convex operation or child workflow. Await immediately,
   * or pass the returned operation directly to
   * {@link ManagedWorkflowCtx.parallel}.
   */
  run(args: StructuredStepArgs<Type, Target>): ManagedStepOperation<FunctionReturnType<Target>>;
};

type BoundManualWorkflowStep = BoundStep & {
  /**
   * Tracks a small inline sequence as one progress step. Always await this call
   * immediately; manual steps cannot participate in structured parallelism.
   */
  run<Result>(callback: () => Promise<Result>): Promise<Result>;
};

type BoundSteps<Steps extends StepDefinitions> = {
  readonly [Key in keyof Steps]: Steps[Key] extends ActivityStepDefinition<
    infer Definition,
    infer Builder
  >
    ? BoundActivityStep<Definition, Builder>
    : Steps[Key] extends WorkflowStepDefinition<infer Type, infer Target>
      ? BoundWorkflowStep<Type, Target>
      : BoundManualWorkflowStep;
};

/**
 * Workflow context enriched with the steps declared by
 * {@link ManagedWorkflowManager.define}.
 *
 * Keep orchestration as ordinary TypeScript: call `steps.*.run()` at the
 * relevant branch, `steps.*.skip()` for branches not taken, and `parallel()`
 * only for structured operations returned by activity or workflow steps.
 */
export type ManagedWorkflowCtx<Steps extends StepDefinitions = StepDefinitions> = WorkflowCtx & {
  readonly steps: BoundSteps<Steps>;
  /**
   * Starts and joins a keyed group of declared activity/workflow operations.
   *
   * Pass fresh `steps.*.run()` results directly in one object. The coordinator
   * records every start before executing the group and preserves each result's
   * inferred type by key. Operations are single-use, nested groups are
   * rejected, and manual steps are excluded by the input type.
   *
   * @see {@link activityStep}
   * @see {@link workflowStep}
   * @see {@link manualWorkflowStep}
   */
  parallel<const Operations extends Readonly<Record<string, ManagedStepOperation<unknown>>>>(
    operations: Operations,
  ): Promise<{ [Key in keyof Operations]: ManagedOperationResult<Operations[Key]> }>;
};

function humanizeStepKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export class ManagedWorkflowManager {
  constructor(
    private readonly workflows: WorkflowManager,
    private readonly component: ComponentApi,
    private readonly lifecycleCompletion: FunctionReference<"mutation", "internal">,
    private readonly activities: ActivityManager,
  ) {}

  /**
   * Captures a managed workflow's validators and consumer-visible step map.
   *
   * Declare the safe, reusable path with {@link activityStep} and
   * {@link workflowStep}; reserve {@link manualWorkflowStep} for a small
   * immediately-awaited escape hatch. Literal step keys and operation types
   * flow into `handler`, while labels default from the key and ordering
   * defaults to declaration order.
   *
   * The handler remains ordinary imperative TypeScript. At runtime all steps
   * are registered before it runs; call `skip()` when an untaken branch needs
   * an immediate reason, while steps never reached are finalized
   * automatically. Structured operations must be awaited immediately or
   * passed directly to `step.parallel()`; do not float, reuse, or manually join
   * them.
   *
   * Changing only the workflow graph does not require an activity version
   * bump. Bump an activity version for incompatible worker-facing changes and
   * `protocolVersion` for incompatible backend-to-worker transport changes.
   *
   * @see {@link ManagedWorkflowManager.start}
   * @see {@link activityStep}
   * @see {@link workflowStep}
   * @see {@link manualWorkflowStep}
   */
  define<
    const Args extends PropertyValidators,
    Returns extends Validator<unknown, "required", string> | void = void,
    const Steps extends StepDefinitions = Record<never, never>,
  >(config: {
    args: Args;
    returns?: Returns;
    workpoolOptions?: Parameters<WorkflowManager["define"]>[0]["workpoolOptions"];
    steps?: Steps;
  }): {
    readonly steps: Steps;
    /**
     * Registers the durable workflow handler with the definition's inferred
     * arguments, return value, and bound step map.
     *
     * Prefer plain domain functions for reads and writes that fit within one
     * Convex transaction. Cross a registered operation, child-workflow, or
     * activity boundary only when durability, runtime isolation, or worker
     * execution requires it.
     *
     * @see {@link ManagedWorkflowManager.define}
     * @see {@link ManagedWorkflowCtx}
     */
    handler(
      fn: (
        step: ManagedWorkflowCtx<Steps>,
        args: ObjectType<Args>,
      ) => Promise<ReturnValueForOptionalValidator<Returns>>,
    ): RegisteredMutation<"internal", WorkflowArgs<Args>, WorkflowId>;
  } {
    const definition = this.workflows.define({
      args: config.args,
      returns: config.returns,
      workpoolOptions: config.workpoolOptions,
    });
    const steps = (config.steps ?? {}) as Steps;
    return {
      steps,
      handler: (fn) =>
        definition.handler(async (workflow, args) => {
          const entries = Object.entries(steps);
          const coordinator = new ManagedOperationCoordinator();
          if (entries.length > 0) {
            await workflow.runMutation(
              this.component.workflowSteps.register,
              {
                workflowId: workflow.workflowId,
                steps: entries.map(([key, step], position) => ({
                  key,
                  label: step.label ?? humanizeStepKey(key),
                  position: step.order ?? position,
                  kind: step.kind === "activity" ? ("activity" as const) : ("workflow" as const),
                })),
              },
              { name: "workflow-steps:register", inline: true },
            );
          }
          const bound = Object.fromEntries(
            entries.map(([key, step]) => [
              key,
              step.kind === "activity"
                ? this.bindActivityStep(workflow, coordinator, key, step)
                : step.kind === "workflow"
                  ? this.bindWorkflowStep(workflow, coordinator, key, step)
                  : this.bindManualWorkflowStep(workflow, coordinator, key),
            ]),
          ) as BoundSteps<Steps>;
          return await fn(
            {
              ...workflow,
              steps: bound,
              parallel: async (operations) => await coordinator.parallel(operations),
            },
            args,
          );
        }),
    };
  }

  private bindActivityStep<
    Definition extends ActivityDefinition,
    Builder extends InputBuilder | undefined,
  >(
    workflow: WorkflowCtx,
    coordinator: ManagedOperationCoordinator,
    key: string,
    step: ActivityStepDefinition<Definition, Builder>,
  ): BoundActivityStep<Definition, Builder> {
    return {
      run: (args) =>
        coordinator.operation(() => {
          let activityId: string | undefined;
          return {
            start: async () => {
              await workflow.runMutation(
                this.component.workflowSteps.startActivity,
                {
                  workflowId: workflow.workflowId,
                  key,
                },
                { name: `${key}:start`, inline: true },
              );
              const input = step.input
                ? await workflow.runQuery(
                    step.input,
                    {
                      ...args,
                      workflowId: workflow.workflowId,
                    } as never,
                    { name: `${key}:input`, inline: true },
                  )
                : args;
              const schedulingContext = {
                runQuery: async (query: Parameters<WorkflowCtx["runQuery"]>[0], args: unknown) =>
                  await workflow.runQuery(query as never, args as never, {
                    name: `${key}:artifact-scope`,
                    inline: true,
                  }),
                runMutation: async (
                  mutation: Parameters<WorkflowCtx["runMutation"]>[0],
                  args: unknown,
                ) =>
                  await workflow.runMutation(mutation as never, args as never, {
                    name: `${key}:schedule`,
                    inline: true,
                  }),
              };
              try {
                activityId = await this.activities.schedule(
                  schedulingContext as never,
                  workflow.workflowId,
                  step.activity,
                  input as ActivityInput<Definition>,
                );
              } catch (error) {
                await workflow.runMutation(
                  this.component.workflowSteps.failActivity,
                  {
                    workflowId: workflow.workflowId,
                    key,
                    error: error instanceof Error ? error.message : String(error),
                  },
                  { name: `${key}:fail`, inline: true },
                );
                throw error;
              }
              await workflow.runMutation(
                this.component.workflowSteps.linkActivity,
                {
                  workflowId: workflow.workflowId,
                  key,
                  activityId,
                },
                { name: `${key}:link`, inline: true },
              );
            },
            execute: async () => {
              if (!activityId) throw new Error(`Activity step ${key} was not scheduled`);
              return await workflow.awaitEvent<ActivityOutput<Definition>>({
                name: activityId,
                validator: step.activity.output,
              });
            },
            finish: async () => {},
          };
        }),
      skip: async (message) =>
        await coordinator.exclusive(() => this.skipStepPlan(workflow, key, message)),
    };
  }

  private bindWorkflowStep<
    Type extends StructuredOperationType,
    Target extends StructuredTarget<Type>,
  >(
    workflow: WorkflowCtx,
    coordinator: ManagedOperationCoordinator,
    key: string,
    step: WorkflowStepDefinition<Type, Target>,
  ): BoundWorkflowStep<Type, Target> {
    return {
      run: (args) =>
        coordinator.operation(() => ({
          start: async () => await this.startWorkflowStep(workflow, key),
          execute: async () => await this.runStructuredWorkflowStep(workflow, key, step, args),
          finish: async (result) => await this.finishWorkflowStep(workflow, key, result),
        })),
      skip: async (message) =>
        await coordinator.exclusive(() => this.skipStepPlan(workflow, key, message)),
    };
  }

  private bindManualWorkflowStep(
    workflow: WorkflowCtx,
    coordinator: ManagedOperationCoordinator,
    key: string,
  ): BoundManualWorkflowStep {
    return {
      run: async <Result>(callback: () => Promise<Result>) =>
        await coordinator.exclusive(() => ({
          start: async () => await this.startWorkflowStep(workflow, key),
          execute: callback,
          finish: async (result) => await this.finishWorkflowStep(workflow, key, result),
        })),
      skip: async (message) =>
        await coordinator.exclusive(() => this.skipStepPlan(workflow, key, message)),
    };
  }

  private async startWorkflowStep(workflow: WorkflowCtx, key: string) {
    await workflow.runMutation(
      this.component.workflowSteps.start,
      {
        workflowId: workflow.workflowId,
        key,
      },
      { name: `${key}:start`, inline: true },
    );
  }

  private async finishWorkflowStep(
    workflow: WorkflowCtx,
    key: string,
    result: PromiseSettledResult<unknown>,
  ) {
    const failed = result.status === "rejected";
    await workflow.runMutation(
      this.component.workflowSteps.finish,
      {
        workflowId: workflow.workflowId,
        key,
        state: failed ? "failed" : "completed",
        ...(!failed
          ? {}
          : {
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            }),
      },
      { name: `${key}:${failed ? "fail" : "complete"}`, inline: true },
    );
  }

  private async runStructuredWorkflowStep<
    Type extends StructuredOperationType,
    Target extends StructuredTarget<Type>,
  >(
    workflow: WorkflowCtx,
    key: string,
    step: WorkflowStepDefinition<Type, Target>,
    args: StructuredStepArgs<Type, Target>,
  ): Promise<FunctionReturnType<Target>> {
    const options = { ...step.runOptions, name: key };
    if (step.operation === "query") {
      return await workflow.runQuery(step.target as never, args as never, options as never);
    }
    if (step.operation === "mutation") {
      return await workflow.runMutation(step.target as never, args as never, options as never);
    }
    if (step.operation === "action") {
      return await workflow.runAction(step.target as never, args as never, options as never);
    }
    return await workflow.runWorkflow(step.target as never, args as never, options as never);
  }

  private skipStepPlan(
    workflow: WorkflowCtx,
    key: string,
    message?: string,
  ): ManagedOperationPlan<void> {
    return {
      start: async () => {},
      execute: async () => {
        await workflow.runMutation(
          this.component.workflowSteps.skip,
          {
            workflowId: workflow.workflowId,
            key,
            message,
          },
          { name: `${key}:skip`, inline: true },
        );
      },
      finish: async () => {},
    };
  }

  async getProgress(
    ctx:
      | Pick<GenericMutationCtx<GenericDataModel>, "runQuery">
      | Pick<GenericQueryCtx<GenericDataModel>, "runQuery">,
    workflowId: WorkflowId,
  ) {
    return await ctx.runQuery(this.component.workflowSteps.list, { workflowId });
  }

  async cancelActivities(
    ctx: Pick<GenericMutationCtx<GenericDataModel>, "runQuery" | "runMutation">,
    workflowId: WorkflowId,
  ) {
    const steps = await this.getProgress(ctx, workflowId);
    await Promise.all(
      steps
        .filter((step) => step.activityId && (step.state === "queued" || step.state === "running"))
        .map(async (step) => await this.activities.cancel(ctx, step.activityId as any)),
    );
  }

  /**
   * Starts a definition created by {@link ManagedWorkflowManager.define} with
   * managed artifact cleanup and optional completion handling.
   *
   * Use this instead of the underlying workflow manager so artifact scope and
   * progress finalization remain coupled to the workflow lifecycle.
   *
   * @see {@link ManagedWorkflowManager.define}
   */
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
  await ctx.runMutation(activities.workflowSteps.finalize, {
    workflowId: args.workflowId,
    succeeded: args.result.kind === "success",
  });

  const completion = args.context.completion;
  if (completion) {
    await ctx.runMutation(completion.fnHandle as FunctionHandle<"mutation">, {
      workflowId: args.workflowId,
      result: args.result,
      context: completion.context,
    });
  }
}
