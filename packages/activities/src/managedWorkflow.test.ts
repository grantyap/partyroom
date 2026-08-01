import { describe, expect, test, vi } from "vitest";
import type { WorkflowId } from "@convex-dev/workflow";
import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import { defineActivity, defineQueue, wire } from "./client";
import {
  actionOptions,
  activityStep,
  ManagedWorkflowManager,
  manualWorkflowStep,
  mutationOptions,
  queryOptions,
  settleManagedWorkflow,
  workflowOptions,
  workflowStep,
} from "./managedWorkflow";

const scopeId = "scope-1";
const workflowId = "workflow-1" as WorkflowId;
const component = {
  artifacts: {
    createScope: "create-scope",
    attachWorkflow: "attach-workflow",
    closeScope: "close-scope",
    abandonScope: "abandon-scope",
  },
  workflowSteps: {
    finalize: "finalize-workflow-steps",
  },
} as never;

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("managed artifact workflows", () => {
  test("creates and privately binds one artifact scope when starting a workflow", async () => {
    const start = vi.fn(async () => workflowId);
    const manager = new ManagedWorkflowManager(
      { start } as never,
      component,
      "lifecycle-completion" as never,
      {} as never,
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
    expect(runMutation).toHaveBeenNthCalledWith(2, "finalize-workflow-steps", {
      workflowId,
      succeeded: true,
    });
    expect(runMutation).toHaveBeenNthCalledWith(3, "domain-completion", {
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

    expect(runMutation).toHaveBeenNthCalledWith(1, "abandon-scope", { scopeId });
    expect(runMutation).toHaveBeenNthCalledWith(2, "finalize-workflow-steps", {
      workflowId,
      succeeded: false,
    });
  });

  test("builds typed activity input with the current workflow ID", async () => {
    let registeredHandler:
      | ((workflow: Record<string, any>, args: { jobId: string }) => Promise<unknown>)
      | undefined;
    const workflows = {
      define: vi.fn(() => ({
        handler: vi.fn((handler) => {
          registeredHandler = handler;
          return "registered-workflow";
        }),
      })),
    };
    const activity = defineActivity({
      name: "example.echo",
      version: 1,
      queue: defineQueue("example", { leaseDurationMs: 10_000 }),
      input: wire.object({ value: wire.string }),
      output: wire.object({ echoed: wire.string }),
      startToCloseTimeoutMs: 60_000,
      scheduleToCloseTimeoutMs: 300_000,
    });
    const inputBuilder = "build-input" as unknown as FunctionReference<
      "query",
      "internal",
      { jobId: string; workflowId: WorkflowId },
      { value: string }
    >;
    const schedule = vi.fn(async () => "activity-1");
    const manager = new ManagedWorkflowManager(
      workflows as never,
      {
        workflowSteps: {
          register: "register-steps",
          startActivity: "start-activity",
          failActivity: "fail-activity",
          linkActivity: "link-activity",
        },
      } as never,
      "lifecycle-completion" as never,
      { schedule } as never,
    );
    const definition = manager.define({
      args: { jobId: v.string() },
      steps: {
        echo: activityStep(activity, { input: inputBuilder }),
      },
    });
    definition.handler(async (workflow, { jobId }) => {
      return await workflow.steps.echo.run({ jobId });
    });

    const runQuery = vi.fn(async (fn, args) => {
      expect(fn).toBe(inputBuilder);
      expect(args).toEqual({ jobId: "job-1", workflowId });
      return { value: "prepared" };
    });
    const runMutation = vi.fn(async () => null);
    const awaitEvent = vi.fn(async () => ({ echoed: "prepared" }));
    await expect(
      registeredHandler?.(
        {
          workflowId,
          runQuery,
          runMutation,
          awaitEvent,
        },
        { jobId: "job-1" },
      ),
    ).resolves.toEqual({ echoed: "prepared" });

    expect(schedule).toHaveBeenCalledWith(expect.any(Object), workflowId, activity, {
      value: "prepared",
    });
    expect(runMutation).toHaveBeenCalledWith(
      "start-activity",
      { workflowId, key: "echo" },
      { name: "echo:start", inline: true },
    );
  });

  test("constructs reusable typed options for every Convex operation kind", () => {
    const query = "query" as unknown as FunctionReference<"query", "internal", {}, string>;
    const mutation = "mutation" as unknown as FunctionReference<"mutation", "internal", {}, null>;
    const action = "action" as unknown as FunctionReference<"action", "internal", {}, number>;
    const childWorkflow = "workflow" as unknown as FunctionReference<
      "mutation",
      "internal",
      { args: { value: string } },
      WorkflowId
    >;

    const queryDefinition = queryOptions({ query, inline: true });
    const mutationDefinition = mutationOptions({ mutation, inline: true });
    const actionDefinition = actionOptions({ action, retry: true });
    const workflowDefinition = workflowOptions({ workflow: childWorkflow });

    expect(queryDefinition).toEqual({
      kind: "workflowOperation",
      operation: "query",
      target: query,
      runOptions: { inline: true },
    });
    expect(mutationDefinition.operation).toBe("mutation");
    expect(actionDefinition.runOptions).toEqual({ retry: true });
    expect(workflowDefinition.target).toBe(childWorkflow);
    expect(Object.isFrozen(queryDefinition)).toBe(true);
    expect(
      workflowStep(actionDefinition, {
        label: "Reusable action",
        order: 2,
      }),
    ).toMatchObject({
      operation: "action",
      target: action,
      runOptions: { retry: true },
      label: "Reusable action",
      order: 2,
    });
  });

  test("runs a structured workflow step with inferred arguments and result", async () => {
    let registeredHandler:
      | ((workflow: Record<string, any>, args: { value: string }) => Promise<unknown>)
      | undefined;
    const workflows = {
      define: vi.fn(() => ({
        handler: vi.fn((handler) => {
          registeredHandler = handler;
          return "registered-workflow";
        }),
      })),
    };
    const query = "uppercase" as unknown as FunctionReference<
      "query",
      "internal",
      { value: string },
      string
    >;
    const manager = new ManagedWorkflowManager(
      workflows as never,
      {
        workflowSteps: {
          register: "register-steps",
          start: "start-step",
          finish: "finish-step",
        },
      } as never,
      "lifecycle-completion" as never,
      {} as never,
    );
    manager
      .define({
        args: { value: v.string() },
        steps: {
          uppercase: workflowStep(queryOptions({ query, inline: true })),
        },
      })
      .handler(async (step, { value }) => await step.steps.uppercase.run({ value }));

    const runMutation = vi.fn(async () => null);
    const runQuery = vi.fn(async (target, args) => {
      expect(target).toBe(query);
      return String(args.value).toUpperCase();
    });
    await expect(
      registeredHandler?.({ workflowId, runMutation, runQuery }, { value: "hello" }),
    ).resolves.toBe("HELLO");

    expect(runMutation).toHaveBeenCalledWith(
      "start-step",
      { workflowId, key: "uppercase" },
      { name: "uppercase:start", inline: true },
    );
    expect(runQuery).toHaveBeenCalledWith(
      query,
      { value: "hello" },
      { inline: true, name: "uppercase" },
    );
    expect(runMutation).toHaveBeenCalledWith(
      "finish-step",
      { workflowId, key: "uppercase", state: "completed" },
      { name: "uppercase:complete", inline: true },
    );
  });

  test("finishes parallel structured steps in declaration order", async () => {
    let registeredHandler:
      | ((workflow: Record<string, any>, args: {}) => Promise<unknown>)
      | undefined;
    const workflows = {
      define: vi.fn(() => ({
        handler: vi.fn((handler) => {
          registeredHandler = handler;
          return "registered-workflow";
        }),
      })),
    };
    const first = "first-query" as unknown as FunctionReference<"query", "internal", {}, string>;
    const second = "second-query" as unknown as FunctionReference<"query", "internal", {}, string>;
    const firstResult = deferred<string>();
    const secondResult = deferred<string>();
    const journal: string[] = [];
    const manager = new ManagedWorkflowManager(
      workflows as never,
      {
        workflowSteps: {
          register: "register-steps",
          start: "start-step",
          finish: "finish-step",
        },
      } as never,
      "lifecycle-completion" as never,
      {} as never,
    );
    manager
      .define({
        args: {},
        steps: {
          first: workflowStep(queryOptions({ query: first, inline: true })),
          second: workflowStep(queryOptions({ query: second, inline: true })),
        },
      })
      .handler(
        async (step) =>
          await step.parallel({
            first: step.steps.first.run({}),
            second: step.steps.second.run({}),
          }),
      );

    const runMutation = vi.fn(async (_target, _args, options) => {
      journal.push(options.name);
      return null;
    });
    const runQuery = vi.fn(async (target, _args, options) => {
      journal.push(options.name);
      return await (target === first ? firstResult.promise : secondResult.promise);
    });
    const result = registeredHandler?.({ workflowId, runMutation, runQuery }, {});
    await Promise.resolve();
    await Promise.resolve();
    secondResult.resolve("second");
    await Promise.resolve();
    expect(journal).not.toContain("first:complete");
    firstResult.resolve("first");

    await expect(result).resolves.toEqual({ first: "first", second: "second" });
    expect(journal.slice(-2)).toEqual(["first:complete", "second:complete"]);
  });

  test("rejects a managed step started while a manual step is unawaited", async () => {
    let registeredHandler:
      | ((workflow: Record<string, any>, args: {}) => Promise<unknown>)
      | undefined;
    const workflows = {
      define: vi.fn(() => ({
        handler: vi.fn((handler) => {
          registeredHandler = handler;
          return "registered-workflow";
        }),
      })),
    };
    const query = "read" as unknown as FunctionReference<"query", "internal", {}, null>;
    const callback = deferred<void>();
    const manager = new ManagedWorkflowManager(
      workflows as never,
      {
        workflowSteps: {
          register: "register-steps",
          start: "start-step",
          finish: "finish-step",
        },
      } as never,
      "lifecycle-completion" as never,
      {} as never,
    );
    manager
      .define({
        args: {},
        steps: {
          manual: manualWorkflowStep(),
          read: workflowStep(queryOptions({ query, inline: true })),
        },
      })
      .handler(async (step) => {
        const unawaited = step.steps.manual.run(async () => await callback.promise);
        let message = "";
        try {
          await step.steps.read.run({});
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }
        callback.resolve();
        await unawaited;
        return message;
      });

    await expect(
      registeredHandler?.(
        {
          workflowId,
          runMutation: vi.fn(async () => null),
          runQuery: vi.fn(async () => null),
        },
        {},
      ),
    ).resolves.toContain("Await it immediately");
  });
});
