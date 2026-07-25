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
          supportedActivities: Array<{ name: string; version: number }>;
          taskQueue: string;
          workerId: string;
        },
        null | {
          activityId: string;
          activityType: string;
          activityVersion: number;
          artifactScopeId?: string;
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
      closeScope: FunctionReference<
        "mutation",
        "internal",
        { keep: Array<string>; scopeId: string },
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
  };
