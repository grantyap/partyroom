import { vResultValidator } from "@convex-dev/workpool";
import { vWorkflowId } from "@convex-dev/workflow";
import { mediaActivities } from "@partyroom/media-activities";
import {
  artifactWorkflowResult,
  type ActivityOutput,
  type ArtifactId,
} from "@partyroom/activities";
import { v } from "convex/values";
import type { Validator } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { managedWorkflow } from "../activities/workflowManager";
import type { OperationKind } from "./validators";

export const mediaPipeline = managedWorkflow
  .define({ args: { jobId: v.id("mediaJobs") } })
  .handler(async (step, { jobId, artifactScopeId }) => {
    const runActivity = async <Kind extends OperationKind>(
      kind: Kind,
    ): Promise<ActivityOutput<(typeof mediaActivities)[Kind]>> => {
      const activityId = await step.runMutation(
        internal.media.activities.schedule,
        { jobId, workflowId: step.workflowId, artifactScopeId, kind },
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
        return artifactWorkflowResult([]);
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
        return artifactWorkflowResult([]);
      }

      const download = await runActivity("download");
      await step.runMutation(
        internal.media.jobs.recordStageResult,
        {
          jobId,
          kind: "download",
          artifactId: download.storageId,
        },
        { name: "record-download", inline: true },
      );
      const extracted = await runActivity("extractAudio");
      await step.runMutation(
        internal.media.jobs.recordStageResult,
        {
          jobId,
          kind: "extractAudio",
          artifactId: extracted.storageId,
        },
        { name: "record-extractAudio", inline: true },
      );
      const separated = await runActivity("separate");
      await step.runMutation(
        internal.media.jobs.recordStageResult,
        {
          jobId,
          kind: "separate",
          artifactId: separated.instrumentalStorageId,
          secondaryArtifactId: separated.vocalsStorageId,
        },
        { name: "record-separate", inline: true },
      );

      const [transcription, melody, mux] = await Promise.all([
        runActivity("transcribe"),
        runActivity("analyzeMelody").catch(async (error) => {
          await step.runMutation(
            internal.media.jobs.markAnnotationsFailed,
            {
              jobId,
              errorMessage: error instanceof Error ? error.message : String(error),
            },
            { name: "mark-melody-failed", inline: true },
          );
          return null;
        }),
        runActivity("mux"),
      ]);
      await step.runMutation(
        internal.media.jobs.recordStageResult,
        {
          jobId,
          kind: "transcribe",
          artifactId: transcription.storageId,
          secondaryArtifactId: transcription.timedLyricsStorageId,
        },
        { name: "record-transcribe", inline: true },
      );
      await step.runMutation(
        internal.media.jobs.recordStageResult,
        {
          jobId,
          kind: "mux",
          artifactId: mux.storageId,
        },
        { name: "record-mux", inline: true },
      );

      const retainedArtifacts: ArtifactId[] = [
        separated.instrumentalStorageId,
        transcription.storageId,
        transcription.timedLyricsStorageId,
        mux.storageId,
      ];
      if (melody) {
        await step.runMutation(
          internal.media.jobs.recordStageResult,
          {
            jobId,
            kind: "analyzeMelody",
            artifactId: melody.storageId,
          },
          { name: "record-analyzeMelody", inline: true },
        );
        try {
          const annotations = await runActivity("assembleAnnotations");
          await step.runMutation(
            internal.media.jobs.recordStageResult,
            {
              jobId,
              kind: "assembleAnnotations",
              artifactId: annotations.annotationsStorageId,
              secondaryArtifactId: annotations.midiStorageId,
              tertiaryArtifactId: annotations.musicXmlStorageId,
            },
            { name: "record-assembleAnnotations", inline: true },
          );
          retainedArtifacts.push(
            annotations.annotationsStorageId,
            annotations.midiStorageId,
            annotations.musicXmlStorageId,
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
      return artifactWorkflowResult(retainedArtifacts);
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
