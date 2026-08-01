import { vResultValidator } from "@convex-dev/workpool";
import { vWorkflowId } from "@convex-dev/workflow";
import { mediaActivities } from "@partyroom/media-activities";
import { type ActivityOutput } from "@partyroom/activities";
import { v } from "convex/values";
import type { Validator } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { managedWorkflow } from "../activities/workflowManager";
import type { OperationKind } from "./validators";

export const mediaPipeline = managedWorkflow
  .define({ args: { jobId: v.id("mediaJobs") } })
  .handler(async (step, { jobId }) => {
    const runActivity = async <Kind extends OperationKind>(
      kind: Kind,
    ): Promise<ActivityOutput<(typeof mediaActivities)[Kind]>> => {
      const activityId = await step.runMutation(
        internal.media.activities.schedule,
        { jobId, workflowId: step.workflowId, kind },
        { name: `schedule-${kind}`, inline: true },
      );
      return await step.awaitEvent<ActivityOutput<(typeof mediaActivities)[Kind]>>({
        name: activityId,
        validator: mediaActivities[kind].output as Validator<
          ActivityOutput<(typeof mediaActivities)[Kind]>,
          any,
          any
        >,
      });
    };

    try {
      const resolved = await runActivity("resolve");
      const claim = await step.runMutation(
        internal.media.jobs.claimAsset,
        {
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
          { jobId, assetId: claim.assetId },
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
          { jobId, assetId },
          { inline: true },
        );
        return;
      }

      const lrclibLyricsBranch = (async () => {
        try {
          await step.runMutation(
            internal.media.jobs.recordLyricTrack,
            {
              jobId,
              source: "lrclib",
              label: "LRCLIB",
              timing: "line",
              state: "processing",
            },
            { name: "mark-lrclib-processing", inline: true },
          );
          const result = await step.runAction(
            internal.media.lrclib.lookup,
            {
              jobId,
              title: resolved.title ?? "Untitled media",
              duration: resolved.duration,
            },
            {
              name: "lookup-lrclib",
              retry: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 },
            },
          );
          await step.runMutation(
            internal.media.jobs.recordLyricTrack,
            {
              jobId,
              source: "lrclib",
              label: "LRCLIB",
              timing: result.timing,
              state: result.state,
              observations: result.observations,
              metadata: {
                providerId: result.id === undefined ? undefined : String(result.id),
                trackName: result.trackName,
                artistName: result.artistName,
                albumName: result.albumName,
                format: result.format,
              },
            },
            { name: "record-lrclib", inline: true },
          );
        } catch (error) {
          await step.runMutation(
            internal.media.jobs.recordLyricTrack,
            {
              jobId,
              source: "lrclib",
              label: "LRCLIB",
              timing: "line",
              state: "failed",
              errorMessage: error instanceof Error ? error.message : String(error),
            },
            { name: "mark-lrclib-failed", inline: true },
          );
        }
      })();

      const download = await runActivity("download");
      await step.runMutation(
        internal.media.jobs.recordStageResult,
        {
          jobId,
          kind: "download",
          artifactId: download.artifactId,
        },
        { name: "record-download", inline: true },
      );
      const extracted = await runActivity("extractAudio");
      await step.runMutation(
        internal.media.jobs.recordStageResult,
        {
          jobId,
          kind: "extractAudio",
          artifactId: extracted.artifactId,
        },
        { name: "record-extractAudio", inline: true },
      );
      const separated = await runActivity("separate");
      await step.runMutation(
        internal.media.jobs.recordStageResult,
        {
          jobId,
          kind: "separate",
          artifactId: separated.instrumentalArtifactId,
          secondaryArtifactId: separated.vocalsArtifactId,
        },
        { name: "record-separate", inline: true },
      );

      const transcriptionBranch = (async () => {
        const result = await runActivity("transcribe");
        await step.runMutation(
          internal.media.jobs.recordLyricTrack,
          {
            jobId,
            source: "generated",
            label: "Generated",
            timing: "word",
            state: "ready",
            textArtifactId: result.lyricsArtifactId,
            timedArtifactId: result.timedLyricsArtifactId,
          },
          { name: "record-transcribe", inline: true },
        );
        return result;
      })();
      const melodyBranch = (async () => {
        try {
          const result = await runActivity("analyzeMelody");
          await step.runMutation(
            internal.media.jobs.recordStageResult,
            {
              jobId,
              kind: "analyzeMelody",
              artifactId: result.artifactId,
            },
            { name: "record-analyzeMelody", inline: true },
          );
          return result;
        } catch (error) {
          await step.runMutation(
            internal.media.jobs.markAnnotationsFailed,
            {
              jobId,
              errorMessage: error instanceof Error ? error.message : String(error),
            },
            { name: "mark-melody-failed", inline: true },
          );
          return null;
        }
      })();
      const muxBranch = (async () => {
        const result = await runActivity("mux");
        await step.runMutation(
          internal.media.jobs.recordStageResult,
          {
            jobId,
            kind: "mux",
            artifactId: result.artifactId,
          },
          { name: "record-mux", inline: true },
        );
        return result;
      })();

      const [, melody] = await Promise.all([
        transcriptionBranch,
        melodyBranch,
        muxBranch,
        lrclibLyricsBranch,
      ]);

      try {
        const inputs = await step.runQuery(
          internal.media.jobs.getLyricOffsetSuggestionInputs,
          { jobId },
          { name: "prepare-lyric-offset", inline: true },
        );
        if (inputs) {
          const suggestedOffsetMs = await step.runAction(
            internal.media.lrclib.suggestOffset,
            { jobId, ...inputs },
            { name: "suggest-lyric-offset" },
          );
          if (suggestedOffsetMs !== null) {
            await step.runMutation(
              internal.media.jobs.recordSuggestedLyricOffset,
              { jobId, source: "lrclib", suggestedOffsetMs },
              { name: "record-lyric-offset", inline: true },
            );
          }
        }
      } catch (error) {
        console.warn("[lrclib] Unable to suggest lyrics offset", {
          jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (melody) {
        try {
          const annotations = await runActivity("assembleAnnotations");
          await step.runMutation(
            internal.media.jobs.recordStageResult,
            {
              jobId,
              kind: "assembleAnnotations",
              artifactId: annotations.annotationsArtifactId,
              secondaryArtifactId: annotations.midiArtifactId,
              tertiaryArtifactId: annotations.musicXmlArtifactId,
            },
            { name: "record-assembleAnnotations", inline: true },
          );
        } catch (error) {
          await step.runMutation(
            internal.media.jobs.markAnnotationsFailed,
            {
              jobId,
              errorMessage: error instanceof Error ? error.message : String(error),
            },
            { name: "mark-annotations-failed", inline: true },
          );
        }
      }
      await step.runMutation(
        internal.media.jobs.finalizeAsset,
        { jobId },
        { name: "finalize-asset", inline: true },
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.runMutation(
        internal.media.jobs.failJob,
        { jobId, errorCode: "MEDIA_PIPELINE_FAILED", errorMessage: message },
        { name: "fail-job", inline: true },
      );
      throw error;
    }
  });

export const onPipelineComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ jobId: v.id("mediaJobs") }),
  },
  returns: v.null(),
  handler: async (ctx, { result, context }) => {
    if (result.kind === "success") return null;
    const errorMessage = result.kind === "failed" ? result.error : "Media processing was canceled";
    await ctx.runMutation(internal.media.jobs.failJob, {
      jobId: context.jobId,
      errorCode: result.kind === "canceled" ? "MEDIA_PIPELINE_CANCELED" : "MEDIA_PIPELINE_FAILED",
      errorMessage,
    });
    return null;
  },
});
