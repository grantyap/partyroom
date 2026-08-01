/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activities_activityCompletion from "../activities/activityCompletion.js";
import type * as activities_defineActivityInput from "../activities/defineActivityInput.js";
import type * as activities_http from "../activities/http.js";
import type * as activities_managedWorkflow from "../activities/managedWorkflow.js";
import type * as activities_workflowManager from "../activities/workflowManager.js";
import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as healthCheck from "../healthCheck.js";
import type * as http from "../http.js";
import type * as media_actions from "../media/actions.js";
import type * as media_activityCompletion from "../media/activityCompletion.js";
import type * as media_activityInputs_core from "../media/activityInputs/core.js";
import type * as media_activityInputs_enrichment from "../media/activityInputs/enrichment.js";
import type * as media_crypto from "../media/crypto.js";
import type * as media_domain_assets from "../media/domain/assets.js";
import type * as media_domain_jobs from "../media/domain/jobs.js";
import type * as media_domain_lyrics from "../media/domain/lyrics.js";
import type * as media_enrichment from "../media/enrichment.js";
import type * as media_enrichmentActivityCompletion from "../media/enrichmentActivityCompletion.js";
import type * as media_jobs from "../media/jobs.js";
import type * as media_lrclib from "../media/lrclib.js";
import type * as media_pipeline from "../media/pipeline.js";
import type * as media_progress_model from "../media/progress/model.js";
import type * as media_urls from "../media/urls.js";
import type * as media_validators from "../media/validators.js";
import type * as presence from "../presence.js";
import type * as rooms from "../rooms.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "activities/activityCompletion": typeof activities_activityCompletion;
  "activities/defineActivityInput": typeof activities_defineActivityInput;
  "activities/http": typeof activities_http;
  "activities/managedWorkflow": typeof activities_managedWorkflow;
  "activities/workflowManager": typeof activities_workflowManager;
  auth: typeof auth;
  chat: typeof chat;
  healthCheck: typeof healthCheck;
  http: typeof http;
  "media/actions": typeof media_actions;
  "media/activityCompletion": typeof media_activityCompletion;
  "media/activityInputs/core": typeof media_activityInputs_core;
  "media/activityInputs/enrichment": typeof media_activityInputs_enrichment;
  "media/crypto": typeof media_crypto;
  "media/domain/assets": typeof media_domain_assets;
  "media/domain/jobs": typeof media_domain_jobs;
  "media/domain/lyrics": typeof media_domain_lyrics;
  "media/enrichment": typeof media_enrichment;
  "media/enrichmentActivityCompletion": typeof media_enrichmentActivityCompletion;
  "media/jobs": typeof media_jobs;
  "media/lrclib": typeof media_lrclib;
  "media/pipeline": typeof media_pipeline;
  "media/progress/model": typeof media_progress_model;
  "media/urls": typeof media_urls;
  "media/validators": typeof media_validators;
  presence: typeof presence;
  rooms: typeof rooms;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  activities: import("@partyroom/activities/_generated/component.js").ComponentApi<"activities">;
};
