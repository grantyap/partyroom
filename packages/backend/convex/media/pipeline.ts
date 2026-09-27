import { vResultValidator } from "@convex-dev/workpool";
import { vWorkflowId, type WorkflowId } from "@convex-dev/workflow";
import { mediaActivities } from "@partyroom/media-activities";
import {
  activityStep,
  type ActivityDefinition,
  type ActivityInput,
  workflowStep,
} from "@partyroom/activities";
import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { managedWorkflow } from "../activities/workflowManager";

type InputBuilder<Definition extends ActivityDefinition, Args> = FunctionReference<
  "query",
  "internal",
  Args & { workflowId: WorkflowId },
  ActivityInput<Definition>
>;

type LyricsLookup = FunctionReference<
  "action",
  "internal",
  {
    jobId: Id<"mediaJobs">;
    title: string;
    duration?: number;
    trackName?: string;
    artistName?: string;
    albumName?: string;
  },
  {
    state: "ready" | "not_found";
    timing: "word" | "line";
    observations: Array<{ time: number; duration: number; value: string }>;
    format?: "lyricsfile" | "syncedLyrics";
    id?: number;
    trackName?: string;
    artistName?: string;
    albumName?: string;
  }
>;

const inputBuilders: {
  resolve: InputBuilder<(typeof mediaActivities)["resolve"], { jobId: Id<"mediaJobs"> }>;
  download: InputBuilder<(typeof mediaActivities)["download"], { jobId: Id<"mediaJobs"> }>;
  extractAudio: InputBuilder<(typeof mediaActivities)["extractAudio"], { jobId: Id<"mediaJobs"> }>;
  separate: InputBuilder<(typeof mediaActivities)["separate"], { jobId: Id<"mediaJobs"> }>;
  mux: InputBuilder<(typeof mediaActivities)["mux"], { jobId: Id<"mediaJobs"> }>;
} = {
  resolve: internal.media.activityInputs.core.resolve,
  download: internal.media.activityInputs.core.download,
  extractAudio: internal.media.activityInputs.core.extractAudio,
  separate: internal.media.activityInputs.core.separate,
  mux: internal.media.activityInputs.core.mux,
};

const workflowOperations: {
  fetchLyrics: LyricsLookup;
} = {
  fetchLyrics: internal.media.lrclib.lookup,
};

const mediaPipelineDefinition = managedWorkflow.define({
  args: { jobId: v.id("mediaJobs") },
  steps: {
    resolve: activityStep(mediaActivities.resolve, {
      input: inputBuilders.resolve,
      label: "Resolve source",
      order: 0,
    }),
    fetchLyrics: workflowStep({
      action: workflowOperations.fetchLyrics,
      retry: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 },
      label: "Fetch synced lyrics",
      order: 1,
    }),
    download: activityStep(mediaActivities.download, {
      input: inputBuilders.download,
      label: "Download source",
      order: 2,
    }),
    extractAudio: activityStep(mediaActivities.extractAudio, {
      input: inputBuilders.extractAudio,
      label: "Extract audio",
      order: 3,
    }),
    separate: activityStep(mediaActivities.separate, {
      input: inputBuilders.separate,
      label: "Separate stems",
      order: 4,
    }),
    mux: activityStep(mediaActivities.mux, {
      input: inputBuilders.mux,
      label: "Build final video",
      order: 8,
    }),
  },
});

const mediaPipelineHandler = mediaPipelineDefinition.handler(async (step, { jobId }) => {
  try {
    const resolved = await step.steps.resolve.run({ jobId });
    const claim = await step.runMutation(
      internal.media.jobs.claimAsset,
      {
        workflowId: step.workflowId,
        jobId,
        extractor: resolved.extractor,
        sourceId: resolved.sourceId,
        title: resolved.title,
        duration: resolved.duration,
      },
      { name: "claim-asset", inline: true },
    );

    if (claim.mode === "cached") {
      await step.runMutation(
        internal.media.jobs.completeFromAsset,
        { workflowId: step.workflowId, jobId, assetId: claim.assetId },
        { inline: true },
      );
      return;
    }
    if (claim.mode === "waiting") {
      const assetId = await step.awaitEvent({
        name: "asset-ready",
        validator: v.id("mediaAssets"),
      });
      await step.runMutation(
        internal.media.jobs.completeFromAsset,
        { workflowId: step.workflowId, jobId, assetId },
        { inline: true },
      );
      return;
    }

    await step.runMutation(
      internal.media.jobs.recordLrclib,
      { workflowId: step.workflowId, jobId, result: { state: "processing" } },
      { name: "mark-lrclib-processing", inline: true },
    );
    try {
      const result = await step.steps.fetchLyrics.run({
        jobId,
        title: resolved.title ?? "Untitled media",
        duration: resolved.duration,
        trackName: resolved.track,
        artistName: resolved.artist,
        albumName: resolved.album,
      });
      await step.runMutation(
        internal.media.jobs.recordLrclib,
        {
          workflowId: step.workflowId,
          jobId,
          result:
            result.state === "not_found"
              ? { state: "not_found" }
              : {
                  state: "ready",
                  timing: result.timing,
                  observations: result.observations,
                  metadata: {
                    providerId: result.id === undefined ? undefined : String(result.id),
                    trackName: result.trackName,
                    artistName: result.artistName,
                    albumName: result.albumName,
                    format: result.format,
                  },
                },
        },
        { name: "record-lrclib", inline: true },
      );
    } catch (error) {
      await step.runMutation(
        internal.media.jobs.recordLrclib,
        {
          workflowId: step.workflowId,
          jobId,
          result: {
            state: "failed",
            error: error instanceof Error ? error.message : String(error),
          },
        },
        { name: "mark-lrclib-failed", inline: true },
      );
    }

    const download = await step.steps.download.run({ jobId });
    await step.runMutation(
      internal.media.jobs.recordStageResult,
      {
        workflowId: step.workflowId,
        jobId,
        result: { kind: "download", artifactId: download.artifactId },
      },
      { name: "record-download", inline: true },
    );
    const extracted = await step.steps.extractAudio.run({ jobId });
    await step.runMutation(
      internal.media.jobs.recordStageResult,
      {
        workflowId: step.workflowId,
        jobId,
        result: { kind: "extractAudio", artifactId: extracted.artifactId },
      },
      { name: "record-extractAudio", inline: true },
    );
    const separated = await step.steps.separate.run({ jobId });
    await step.runMutation(
      internal.media.jobs.recordStageResult,
      {
        workflowId: step.workflowId,
        jobId,
        result: {
          kind: "separate",
          instrumentalArtifactId: separated.instrumentalArtifactId,
          vocalsArtifactId: separated.vocalsArtifactId,
        },
      },
      { name: "record-separate", inline: true },
    );
    await step.runMutation(
      internal.media.enrichment.start,
      { workflowId: step.workflowId, jobId },
      { name: "start-enrichment", inline: true },
    );
    const muxed = await step.steps.mux.run({ jobId });
    await step.runMutation(
      internal.media.jobs.recordStageResult,
      { workflowId: step.workflowId, jobId, result: { kind: "mux", artifactId: muxed.artifactId } },
      { name: "record-mux", inline: true },
    );
    await step.runMutation(
      internal.media.jobs.finalizeAsset,
      { workflowId: step.workflowId, jobId },
      { name: "finalize-asset", inline: true },
    );
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await step.runMutation(
      internal.media.jobs.failJob,
      {
        workflowId: step.workflowId,
        jobId,
        errorCode: "MEDIA_PIPELINE_FAILED",
        errorMessage: message,
      },
      { name: "fail-job", inline: true },
    );
    throw error;
  }
});

// Keep the original export forever while v1 journals can still reference it.
export const mediaPipeline = mediaPipelineHandler;
export const mediaPipelineV1 = mediaPipelineHandler;
export const mediaPipelineV2 = mediaPipelineHandler;

export const onPipelineComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ jobId: v.id("mediaJobs") }),
  },
  returns: v.null(),
  handler: async (ctx, { workflowId, result, context }) => {
    if (result.kind === "success") return null;
    const errorMessage = result.kind === "failed" ? result.error : "Media processing was canceled";
    await ctx.runMutation(internal.media.jobs.failJob, {
      jobId: context.jobId,
      workflowId,
      errorCode: result.kind === "canceled" ? "MEDIA_PIPELINE_CANCELED" : "MEDIA_PIPELINE_FAILED",
      errorMessage,
    });
    return null;
  },
});
