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
        { attemptToken: string },
        { accepted: boolean; duplicate: boolean },
        Name
      >;
      cancelScope: FunctionReference<
        "mutation",
        "internal",
        { scopeId: string },
        null,
        Name
      >;
      claim: FunctionReference<
        "mutation",
        "internal",
        {
          protocolVersion: 2;
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
          attemptToken: string;
          input: any;
          leaseExpiresAt: number;
          protocolVersion: number;
          scheduleDeadline: number;
          taskQueue: string;
        },
        Name
      >;
      complete: FunctionReference<
        "mutation",
        "internal",
        { attemptToken: string; value: any },
        { accepted: boolean; duplicate: boolean; retrying: boolean },
        Name
      >;
      fail: FunctionReference<
        "mutation",
        "internal",
        {
          attemptToken: string;
          errorMessage: string;
          errorType: string;
          nonRetryable?: boolean;
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
      getAttemptInput: FunctionReference<
        "query",
        "internal",
        { attemptToken: string },
        { activityType: string; input: any; workflowId: string },
        Name
      >;
      renew: FunctionReference<
        "mutation",
        "internal",
        {
          attemptToken: string;
          heartbeatDetails?: any;
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
          artifactScopeId: string;
          completion?: { context?: any; fnHandle: string };
          input: any;
          inputSchema: any;
          outputSchema: any;
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
      adopt: FunctionReference<
        "mutation",
        "internal",
        {
          artifacts: Array<{ artifactId: string; slot: string }>;
          owner: string;
          workflowId: string;
        },
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
        { attemptToken: string; slot: string },
        { uploadUrl: string },
        Name
      >;
      deleteArtifact: FunctionReference<
        "mutation",
        "internal",
        { artifactId: string; owner: string },
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
        { attemptToken: string; slot: string; storageId: string },
        string,
        Name
      >;
      validateProduced: FunctionReference<
        "query",
        "internal",
        { artifactId: string; slot: string; workflowId: string },
        null,
        Name
      >;
    };
    drain: {
      statusPage: FunctionReference<
        "query",
        "internal",
        { cursor: string | null; limit: number },
        {
          active: Array<string>;
          continueCursor: string;
          isDone: boolean;
          scanned: number;
        },
        Name
      >;
    };
    maintenance: {
      abandonScopes: FunctionReference<
        "mutation",
        "internal",
        { dryRun: boolean; workflowIds: Array<string> },
        { changed: number; issues: Array<{ id: string; reason: string }> },
        Name
      >;
      adoptArtifacts: FunctionReference<
        "mutation",
        "internal",
        {
          dryRun: boolean;
          references: Array<{
            artifactId: string;
            owner: string;
            slot?: string;
          }>;
        },
        { changed: number; issues: Array<{ id: string; reason: string }> },
        Name
      >;
      finalizeWorkflow: FunctionReference<
        "mutation",
        "internal",
        { dryRun: boolean; workflowId: string },
        {
          deletedActivities: number;
          deletedArtifacts: number;
          deletedAttempts: number;
          deletedSteps: number;
          done: boolean;
          issues: Array<{ id: string; reason: string }>;
        },
        Name
      >;
      inspectArtifacts: FunctionReference<
        "query",
        "internal",
        { artifactIds: Array<string> },
        Array<{
          activityId?: string;
          artifactId: string;
          attempt?: number;
          disposition?: "intermediate" | "retained";
          found: boolean;
          owner?: string;
          scopeId?: string;
          slot?: string;
          state?: "staged" | "adopted";
          storageExists: boolean;
          storageId?: string;
          workflowId?: string;
        }>,
        Name
      >;
      migrateActivities: FunctionReference<
        "mutation",
        "internal",
        { cursor: string | null; dryRun: boolean; limit: number },
        {
          changed: number;
          continueCursor: string;
          isDone: boolean;
          issues: Array<{ id: string; reason: string }>;
          scanned: number;
        },
        Name
      >;
      migrateWorkflowSteps: FunctionReference<
        "mutation",
        "internal",
        { cursor: string | null; dryRun: boolean; limit: number },
        {
          changed: number;
          continueCursor: string;
          isDone: boolean;
          issues: Array<{ id: string; reason: string }>;
          scanned: number;
        },
        Name
      >;
      preflightActivities: FunctionReference<
        "query",
        "internal",
        { cursor: string | null; limit: number },
        {
          active: Array<string>;
          activeV1: Array<string>;
          continueCursor: string;
          isDone: boolean;
          issues: Array<{ id: string; reason: string }>;
          legacy: number;
          pendingDeliveries: Array<string>;
          scanned: number;
          workflowIds: Array<string>;
        },
        Name
      >;
    };
    workflowSteps: {
      list: FunctionReference<
        "query",
        "internal",
        { workflowId: string },
        Array<{
          key: string;
          kind: "activity" | "workflow";
          label: string;
          position: number;
        }>,
        Name
      >;
      mark: FunctionReference<
        "mutation",
        "internal",
        {
          error?: string;
          key: string;
          message?: string;
          state?: string;
          workflowId: string;
        },
        null,
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
    };
  };
