/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    activities: {
      acknowledgeCancellation: FunctionReference<
        "mutation",
        "internal",
        {
          activityId: string;
          attempt: number;
          leaseToken: string;
          requestId: string;
        },
        { accepted: boolean; duplicate: boolean },
        Name
      >;
      claim: FunctionReference<
        "mutation",
        "internal",
        {
          protocolVersion: 1;
          supportedActivities: Array<{ name: string; version: number }>;
          taskQueue: string;
          workerId: string;
        },
        null | {
          activityId: string;
          activityType: string;
          activityVersion: number;
          artifactSlots: Array<string>;
          attempt: number;
          attemptDeadline: number;
          input: any;
          leaseExpiresAt: number;
          leaseToken: string;
          protocolVersion: number;
          scheduleDeadline: number;
          taskQueue: string;
        },
        Name
      >;
      complete: FunctionReference<
        "mutation",
        "internal",
        {
          activityId: string;
          attempt: number;
          leaseToken: string;
          requestId: string;
          value: any;
        },
        { accepted: boolean; duplicate: boolean },
        Name
      >;
      fail: FunctionReference<
        "mutation",
        "internal",
        {
          activityId: string;
          attempt: number;
          errorMessage: string;
          errorType: string;
          leaseToken: string;
          nonRetryable?: boolean;
          requestId: string;
        },
        { accepted: boolean; duplicate: boolean; retrying: boolean },
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { activityId: string },
        null | {
          activityId: string;
          activityType: string;
          activityVersion: number;
          attempt: number;
          attemptDeadline?: number;
          cancelRequested: boolean;
          completedAt?: number;
          createdAt: number;
          deliveryState?: "pending" | "delivered";
          lastErrorMessage?: string;
          lastErrorType?: string;
          leaseExpiresAt?: number;
          nextAttemptAt: number;
          progress?: number;
          progressMessage?: string;
          protocolVersion: number;
          result?:
            | { kind: "success"; value: any }
            | { errorMessage: string; errorType: string; kind: "failed" }
            | { kind: "canceled" };
          scheduleDeadline: number;
          startedAt?: number;
          state: "scheduled" | "running" | "completed" | "failed" | "canceled";
          taskQueue: string;
        },
        Name
      >;
      renew: FunctionReference<
        "mutation",
        "internal",
        {
          activityId: string;
          attempt: number;
          heartbeatDetails?: any;
          leaseToken: string;
          progress?: number;
          progressMessage?: string;
        },
        {
          accepted: boolean;
          cancelRequested: boolean;
          leaseExpiresAt?: number;
        },
        Name
      >;
      requestCancel: FunctionReference<
        "mutation",
        "internal",
        { activityId: string },
        null,
        Name
      >;
      schedule: FunctionReference<
        "mutation",
        "internal",
        {
          activityType: string;
          activityVersion: number;
          artifactDefinitions?: Array<{
            disposition: "intermediate" | "retained";
            slot: string;
          }>;
          artifactScopeId?: string;
          artifactSlots?: Array<string>;
          completion?: { context?: any; fnHandle: string };
          input: any;
          queue: { leaseDurationMs: number; maxConcurrentActivities?: number };
          retryPolicy: {
            backoffCoefficient: number;
            initialIntervalMs: number;
            maximumAttempts: number;
            maximumIntervalMs: number;
            nonRetryableErrorTypes: Array<string>;
          };
          scheduleToCloseTimeoutMs: number;
          startToCloseTimeoutMs: number;
          taskQueue: string;
        },
        string,
        Name
      >;
    };
    artifacts: {
      abandonScope: FunctionReference<
        "mutation",
        "internal",
        { scopeId: string },
        null,
        Name
      >;
      attachWorkflow: FunctionReference<
        "mutation",
        "internal",
        { scopeId: string; workflowId: string },
        null,
        Name
      >;
      closeScope: FunctionReference<
        "mutation",
        "internal",
        { scopeId: string },
        null,
        Name
      >;
      createScope: FunctionReference<
        "mutation",
        "internal",
        { ttlMs?: number },
        string,
        Name
      >;
      createUpload: FunctionReference<
        "mutation",
        "internal",
        {
          activityId: string;
          attempt: number;
          leaseToken: string;
          slot: string;
        },
        { uploadUrl: string },
        Name
      >;
      deleteArtifact: FunctionReference<
        "mutation",
        "internal",
        { artifactId: string },
        boolean,
        Name
      >;
      getScopeForWorkflow: FunctionReference<
        "query",
        "internal",
        { workflowId: string },
        string | null,
        Name
      >;
      getUrl: FunctionReference<
        "query",
        "internal",
        { artifactId: string },
        string | null,
        Name
      >;
      registerUpload: FunctionReference<
        "mutation",
        "internal",
        {
          activityId: string;
          attempt: number;
          leaseToken: string;
          slot: string;
          storageId: string;
        },
        string,
        Name
      >;
    };
    workflowSteps: {
      failActivity: FunctionReference<
        "mutation",
        "internal",
        { error: string; key: string; workflowId: string },
        null,
        Name
      >;
      finalize: FunctionReference<
        "mutation",
        "internal",
        { succeeded: boolean; workflowId: string },
        null,
        Name
      >;
      finish: FunctionReference<
        "mutation",
        "internal",
        {
          error?: string;
          key: string;
          state: "completed" | "failed";
          workflowId: string;
        },
        null,
        Name
      >;
      finishActivity: FunctionReference<
        "mutation",
        "internal",
        {
          activityId: string;
          error?: string;
          state: "completed" | "failed" | "canceled";
        },
        null,
        Name
      >;
      linkActivity: FunctionReference<
        "mutation",
        "internal",
        { activityId: string; key: string; workflowId: string },
        null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { workflowId: string },
        Array<{
          activityId?: string;
          attempt?: number;
          completedAt?: number;
          error?: string;
          key: string;
          kind: "activity" | "workflow";
          label: string;
          message?: string;
          position: number;
          progress: number;
          startedAt?: number;
          state:
            | "pending"
            | "queued"
            | "running"
            | "completed"
            | "failed"
            | "canceled"
            | "skipped";
        }>,
        Name
      >;
      register: FunctionReference<
        "mutation",
        "internal",
        {
          steps: Array<{
            key: string;
            kind: "activity" | "workflow";
            label: string;
            position: number;
          }>;
          workflowId: string;
        },
        null,
        Name
      >;
      skip: FunctionReference<
        "mutation",
        "internal",
        { key: string; message?: string; workflowId: string },
        null,
        Name
      >;
      start: FunctionReference<
        "mutation",
        "internal",
        { key: string; workflowId: string },
        null,
        Name
      >;
      startActivity: FunctionReference<
        "mutation",
        "internal",
        { key: string; workflowId: string },
        null,
        Name
      >;
    };
  };
