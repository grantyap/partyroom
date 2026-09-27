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

type WorkflowStepMetadata = {
  readonly label?: string;
  readonly order?: number;
};

type WorkflowStepConfig<
  Type extends StructuredOperationType,
  Target extends StructuredTarget<Type>,
> = Type extends "query"
  ? { readonly query: Target } & StructuredRunOptions<"query"> & WorkflowStepMetadata
  : Type extends "mutation"
    ? { readonly mutation: Target } & StructuredRunOptions<"mutation"> & WorkflowStepMetadata
    : Type extends "action"
      ? { readonly action: Target } & StructuredRunOptions<"action"> & WorkflowStepMetadata
      : { readonly workflow: Target } & StructuredRunOptions<"workflow"> & WorkflowStepMetadata;

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

type AnyStepDefinition =
  | ActivityStepDefinition
  | WorkflowStepDefinition;
type StepDefinitions = Readonly<Record<string, AnyStepDefinition>>;

/**
 * Declares a managed step that runs in an external activity worker.
 *
 * Calling the bound `run(input)` method schedules the activity, waits for its
 * result, validates the output, and reports worker progress. The activity's
 * input and output types remain available to the workflow handler.
 *
 * If the workflow does not already have the activity input, set `options.input`
 * to a typed Convex query. The query must accept `workflowId`; the runtime adds
 * that argument, validates the query result, and schedules the activity with it.
 *
 * Use {@link workflowStep} for a registered query, mutation, action, or child
 * workflow.
 *
 * @see {@link workflowStep}
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
 * Declares a managed step for one registered query, mutation, action, or child
 * workflow.
 *
 * Each step is one durable workflow operation, so it can run in
 * `step.parallel()` and keeps its argument and return types inferred. Put the
 * operation target, run options, label, and order in the same object, such as
 * `{ action, retry, label, order }`.
 *
 * If a step needs several durable operations, put them in a child workflow. If
 * the work runs in an activity worker, use {@link activityStep} instead.
 *
 * @see {@link activityStep}
 * @see {@link ManagedWorkflowManager.define}
 */
export function workflowStep<Target extends StructuredTarget<"query">>(
  config: WorkflowStepConfig<"query", Target>,
): WorkflowStepDefinition<"query", Target>;
export function workflowStep<Target extends StructuredTarget<"mutation">>(
  config: WorkflowStepConfig<"mutation", Target>,
): WorkflowStepDefinition<"mutation", Target>;
export function workflowStep<Target extends StructuredTarget<"action">>(
  config: WorkflowStepConfig<"action", Target>,
): WorkflowStepDefinition<"action", Target>;
export function workflowStep<Target extends StructuredTarget<"workflow">>(
  config: WorkflowStepConfig<"workflow", Target>,
): WorkflowStepDefinition<"workflow", Target>;
export function workflowStep<
  Type extends StructuredOperationType,
  Target extends StructuredTarget<Type>,
>(config: WorkflowStepConfig<Type, Target>): WorkflowStepDefinition<Type, Target> {
  if ("query" in config) {
    const { query, label, order, ...runOptions } = config;
    return Object.freeze({
      kind: "workflow",
      operation: "query",
      target: query,
      runOptions,
      label,
      order,
    }) as WorkflowStepDefinition<Type, Target>;
  }
  if ("mutation" in config) {
    const { mutation, label, order, ...runOptions } = config;
    return Object.freeze({
      kind: "workflow",
      operation: "mutation",
      target: mutation,
      runOptions,
      label,
      order,
    }) as WorkflowStepDefinition<Type, Target>;
  }
  if ("action" in config) {
    const { action, label, order, ...runOptions } = config;
    return Object.freeze({
      kind: "workflow",
      operation: "action",
      target: action,
      runOptions,
      label,
      order,
    }) as WorkflowStepDefinition<Type, Target>;
  }
  const { workflow, label, order, ...runOptions } = config;
  return Object.freeze({
    kind: "workflow",
    operation: "workflow",
    target: workflow,
    runOptions,
    label,
    order,
  }) as WorkflowStepDefinition<Type, Target>;
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

/**
 * Private lifecycle contract used by the managed workflow coordinator.
 *
 * Plans are created by bound step implementations, not by workflow authors.
 * The coordinator runs `prepare` and `finalize` sequentially in declaration
 * order so their durable Convex journal entries remain deterministic. Only
 * `execute` is allowed to run concurrently across plans.
 */
type ManagedOperationPlan<Result> = {
  /**
   * Writes any durable state required before execution, such as marking a step
   * started, building activity input, scheduling an activity, or linking its
   * ID. This phase may contain multiple journal entries and must never be run
   * concurrently with another plan's preparation.
   */
  prepare(): Promise<void>;
  /**
   * Performs or awaits the operation itself. The coordinator may run this
   * phase concurrently with other plans after every plan has been prepared.
   */
  execute(): Promise<Result>;
  /**
   * Records the terminal result after every execution has settled. This phase
   * may write durable journal entries and must remain sequential in declaration
   * order, regardless of execution completion order.
   */
  finalize(result: PromiseSettledResult<Result>): Promise<void>;
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
type ManagedOperationSettledResult<Operation> = PromiseSettledResult<
  ManagedOperationResult<Operation>
>;

class ManagedOperationCoordinator {
  private active = false;
  private readonly used = new Set<string>();

  claim(key: string) {
    if (this.used.has(key)) throw new Error(`Workflow step ${key} has already been run`);
    this.used.add(key);
  }

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
    const settled = await this.settlePlans(
      entries.map(([, operation]) => operation[managedOperation]()),
    );
    const failure = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
    const results = settled.map((result) => (result as PromiseFulfilledResult<unknown>).value);
    return Object.fromEntries(entries.map(([key], index) => [key, results[index]])) as {
      [Key in keyof Operations]: ManagedOperationResult<Operations[Key]>;
    };
  }

  async parallelSettled<
    const Operations extends Readonly<Record<string, ManagedStepOperation<unknown>>>,
  >(
    operations: Operations,
  ): Promise<{
    [Key in keyof Operations]: ManagedOperationSettledResult<Operations[Key]>;
  }> {
    const entries = Object.entries(operations);
    const settled = await this.settlePlans(
      entries.map(([, operation]) => operation[managedOperation]()),
    );
    return Object.fromEntries(entries.map(([key], index) => [key, settled[index]])) as {
      [Key in keyof Operations]: ManagedOperationSettledResult<Operations[Key]>;
    };
  }

  async exclusive<Result>(createPlan: () => ManagedOperationPlan<Result>): Promise<Result> {
    return (await this.runPlans([createPlan()]))[0] as Result;
  }

  private async runPlans(plans: ManagedOperationPlan<unknown>[]) {
    const settled = await this.settlePlans(plans);
    const failure = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
    return settled.map((result) => (result as PromiseFulfilledResult<unknown>).value);
  }

  private async settlePlans(plans: ManagedOperationPlan<unknown>[]) {
    if (this.active) {
      throw new Error(
        "A managed workflow step is already running. Await it immediately, or pass structured steps to step.parallel().",
      );
    }
    this.active = true;
    try {
      // Preparation and finalization may each write several durable journal
      // entries. Keep both phases in declaration order; only execution may
      // race.
      for (const plan of plans) await plan.prepare();
      const settled = await Promise.allSettled(plans.map(async (plan) => await plan.execute()));
      for (const [index, plan] of plans.entries()) {
        await plan.finalize(settled[index]!);
      }
      return settled;
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

type BoundSteps<Steps extends StepDefinitions> = {
  readonly [Key in keyof Steps]: Steps[Key] extends ActivityStepDefinition<
    infer Definition,
    infer Builder
  >
    ? BoundActivityStep<Definition, Builder>
    : Steps[Key] extends WorkflowStepDefinition<infer Type, infer Target>
      ? BoundWorkflowStep<Type, Target>
      : never;
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
   * Runs declared activity and workflow steps concurrently and waits for all of
   * them to finish.
   *
   * Pass fresh `steps.*.run()` results in one object. The method preserves each
   * result's type by key, accepts each operation only once, and rejects nested
   * parallel groups.
   *
   * @see {@link activityStep}
   * @see {@link workflowStep}
   */
  parallel<const Operations extends Readonly<Record<string, ManagedStepOperation<unknown>>>>(
    operations: Operations,
  ): Promise<{ [Key in keyof Operations]: ManagedOperationResult<Operations[Key]> }>;
  /**
   * Runs declared steps concurrently and returns every outcome.
   *
   * Use this when some branches may fail but all branches must finish. A
   * scheduling failure still rejects the group; activity and workflow failures
   * appear as rejected results after each branch reaches a terminal state.
   */
  parallelSettled<const Operations extends Readonly<Record<string, ManagedStepOperation<unknown>>>>(
    operations: Operations,
  ): Promise<{
    [Key in keyof Operations]: ManagedOperationSettledResult<Operations[Key]>;
  }>;
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
   * Defines a managed workflow with typed, named steps.
   *
   * Declare steps with {@link activityStep} and {@link workflowStep}. Their
   * keys, operation types, and input/output types are available in `handler`.
   * Labels default to readable versions of the keys, and order defaults to the
   * declaration order.
   *
   * The handler is ordinary TypeScript. All steps are registered before it
   * runs. Call `skip()` for a branch that is intentionally not taken; steps
   * that the handler never reaches are finalized automatically. Await each
   * operation immediately or pass it directly to `step.parallel()`.
   *
   * Changing only the workflow graph does not require an activity version
   * bump. Increase the activity version for an incompatible worker-facing
   * change, and increase `protocolVersion` for an incompatible backend-to-worker
   * transport change.
   *
   * @see {@link ManagedWorkflowManager.start}
   * @see {@link activityStep}
   * @see {@link workflowStep}
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
                : this.bindWorkflowStep(workflow, coordinator, key, step),
            ]),
          ) as BoundSteps<Steps>;
          return await fn(
            {
              ...workflow,
              steps: bound,
              parallel: async (operations) => await coordinator.parallel(operations),
              parallelSettled: async (operations) => await coordinator.parallelSettled(operations),
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
            prepare: async () => {
              coordinator.claim(key);
              await workflow.runMutation(
                this.component.workflowSteps.mark,
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
              activityId = await this.activities.schedule(
                schedulingContext as never,
                workflow.workflowId,
                step.activity,
                input as ActivityInput<Definition>,
              );
            },
            execute: async () => {
              if (!activityId) throw new Error(`Activity step ${key} was not scheduled`);
              return await workflow.awaitEvent<ActivityOutput<Definition>>({
                name: activityId,
                validator: step.activity.output,
              });
            },
            finalize: async () => {},
          };
        }),
      skip: async (message) =>
        await coordinator.exclusive(() => {
          coordinator.claim(key);
          return this.skipStepPlan(workflow, key, message);
        }),
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
          prepare: async () => {
            coordinator.claim(key);
            await this.startWorkflowStep(workflow, key);
          },
          execute: async () => await this.runStructuredWorkflowStep(workflow, key, step, args),
          finalize: async (result) => await this.finishWorkflowStep(workflow, key, result),
        })),
      skip: async (message) =>
        await coordinator.exclusive(() => {
          coordinator.claim(key);
          return this.skipStepPlan(workflow, key, message);
        }),
    };
  }

  private async startWorkflowStep(workflow: WorkflowCtx, key: string) {
    await workflow.runMutation(
      this.component.workflowSteps.mark,
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
      this.component.workflowSteps.mark,
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
      prepare: async () => {},
      execute: async () => {
        await workflow.runMutation(
          this.component.workflowSteps.mark,
          {
            workflowId: workflow.workflowId,
            key,
            message,
          },
          { name: `${key}:skip`, inline: true },
        );
      },
      finalize: async () => {},
    };
  }

  async getProgress(
    ctx:
      | Pick<GenericMutationCtx<GenericDataModel>, "runQuery">
      | Pick<GenericQueryCtx<GenericDataModel>, "runQuery">,
    workflowId: WorkflowId,
  ) {
    const definitions = await ctx.runQuery(this.component.workflowSteps.list, { workflowId });
    const journal = [] as Awaited<ReturnType<WorkflowManager["listSteps"]>>["page"];
    let cursor: string | null = null;
    do {
      const page = await this.workflows.listSteps(ctx, workflowId, {
        paginationOpts: { cursor, numItems: 100 },
      });
      journal.push(...page.page);
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor);
    const status = await this.workflows.status(ctx, workflowId);
    return await Promise.all(
      definitions
        .sort((a, b) => a.position - b.position)
        .map(async (definition) => {
          const { key } = definition;
          const entries = journal.filter(
            (entry) => entry.name === key || entry.name.startsWith(`${key}:`),
          );
          const schedule = entries.find((entry) => entry.name === `${key}:schedule`);
          const activityId =
            schedule?.runResult?.kind === "success"
              ? (schedule.runResult.returnValue as string)
              : undefined;
          const activity = activityId
            ? await ctx.runQuery(this.component.activities.get, { activityId })
            : null;
          const event = activityId
            ? journal.find((entry) => entry.kind === "event" && entry.name === activityId)
            : undefined;
          const failure = [...entries, ...(event ? [event] : [])].find(
            (entry) => entry.runResult?.kind === "failed",
          );
          const skipped = entries.find((entry) => entry.name === `${key}:skip`);
          const completed = entries.find((entry) => entry.name === `${key}:complete`);
          const explicitFailure = entries.find((entry) => entry.name === `${key}:fail`);
          const state =
            activity?.state === "scheduled"
              ? ("queued" as const)
              : (activity?.state ??
                (failure || explicitFailure
                  ? ("failed" as const)
                  : skipped
                    ? ("skipped" as const)
                    : completed || event?.runResult?.kind === "success"
                      ? ("completed" as const)
                      : status.type === "completed"
                        ? ("skipped" as const)
                        : status.type !== "inProgress"
                          ? ("canceled" as const)
                          : entries.length
                            ? ("running" as const)
                            : ("pending" as const)));
          return {
            ...definition,
            state,
            activityId,
            attempt: activity?.attempt,
            progress: ["completed", "failed", "canceled", "skipped"].includes(state)
              ? 1
              : (activity?.progress ?? 0),
            message:
              activity?.progressMessage ??
              (skipped?.args as { message?: string } | undefined)?.message,
            error:
              activity?.result?.kind === "failed"
                ? activity.result.errorMessage
                : failure?.runResult?.kind === "failed"
                  ? failure.runResult.error
                  : (explicitFailure?.args as { error?: string } | undefined)?.error,
            startedAt: activity?.startedAt ?? entries[0]?.startedAt,
            completedAt:
              activity?.completedAt ??
              completed?.completedAt ??
              failure?.completedAt ??
              event?.completedAt,
          };
        }),
    );
  }

  async cancelActivities(
    ctx: Pick<GenericMutationCtx<GenericDataModel>, "runQuery" | "runMutation">,
    workflowId: WorkflowId,
  ) {
    const scopeId = await ctx.runQuery(this.component.artifacts.getScopeForWorkflow, {
      workflowId,
    });
    if (scopeId) await ctx.runMutation(this.component.activities.cancelScope, { scopeId });
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

  const completion = args.context.completion;
  if (completion) {
    await ctx.runMutation(completion.fnHandle as FunctionHandle<"mutation">, {
      workflowId: args.workflowId,
      result: args.result,
      context: completion.context,
    });
  }
}
