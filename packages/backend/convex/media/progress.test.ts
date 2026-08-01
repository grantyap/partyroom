import { describe, expect, test } from "vitest";
import { mediaPipelineStepStatuses } from "./progress";

describe("media pipeline progress", () => {
  test("reports parallel activities as independently running", () => {
    const steps = mediaPipelineStepStatuses({
      hasAsset: true,
      asset: {
        sourceArtifactId: "source",
        extractedAudioArtifactId: "audio",
        instrumentalArtifactId: "instrumental",
        vocalsArtifactId: "vocals",
      },
      activities: [
        {
          kind: "transcribe",
          state: "running",
          progress: 0.5,
          message: "Transcribed chunk 2 of 4",
          attempt: 1,
        },
        {
          kind: "analyzeMelody",
          state: "running",
          progress: 0.2,
          message: "Extracting notes",
          attempt: 1,
        },
        {
          kind: "mux",
          state: "running",
          progress: 0.8,
          message: "Muxing final video",
          attempt: 1,
        },
      ],
      timings: [],
    });

    expect(steps.filter((step) => step.state === "running")).toEqual([
      {
        kind: "transcribe",
        state: "running",
        progress: 0.5,
        message: "Transcribed chunk 2 of 4",
        attempt: 1,
      },
      {
        kind: "analyzeMelody",
        state: "running",
        progress: 0.2,
        message: "Extracting notes",
        attempt: 1,
      },
      {
        kind: "mux",
        state: "running",
        progress: 0.8,
        message: "Muxing final video",
        attempt: 1,
      },
    ]);
  });

  test("derives completed and pending steps from persisted artifacts", () => {
    const steps = mediaPipelineStepStatuses({
      hasAsset: true,
      asset: { sourceArtifactId: "source" },
      activities: [],
      timings: [],
    });

    expect(steps.find((step) => step.kind === "resolve")?.state).toBe("completed");
    expect(steps.find((step) => step.kind === "download")?.state).toBe("completed");
    expect(steps.find((step) => step.kind === "extractAudio")?.state).toBe("pending");
  });

  test("retains completed timing after the activity leaves the active set", () => {
    const steps = mediaPipelineStepStatuses({
      hasAsset: true,
      asset: { sourceArtifactId: "source" },
      activities: [],
      timings: [
        {
          kind: "download",
          startedAt: 10_000,
          completedAt: 75_000,
        },
      ],
    });

    expect(steps.find((step) => step.kind === "download")).toMatchObject({
      state: "completed",
      startedAt: 10_000,
      completedAt: 75_000,
    });
  });

  test("reports the early LRCLIB workflow step independently", () => {
    const steps = mediaPipelineStepStatuses({
      hasAsset: true,
      lrclibLyricsState: "processing",
      lrclibLyricsTiming: { startedAt: 12_000 },
      asset: null,
      activities: [],
      timings: [],
    });

    expect(steps.find((step) => step.kind === "fetchLyrics")).toMatchObject({
      state: "running",
      progress: 0,
      startedAt: 12_000,
    });
  });

  test("retains LRCLIB completion timing", () => {
    const steps = mediaPipelineStepStatuses({
      hasAsset: true,
      lrclibLyricsState: "ready",
      lrclibLyricsTiming: { startedAt: 12_000, completedAt: 14_500 },
      asset: null,
      activities: [],
      timings: [],
    });

    expect(steps.find((step) => step.kind === "fetchLyrics")).toMatchObject({
      state: "completed",
      startedAt: 12_000,
      completedAt: 14_500,
    });
  });

  test("reports detached lyric generation after playback is ready", () => {
    const steps = mediaPipelineStepStatuses({
      hasAsset: true,
      generatedLyricsState: "processing",
      generatedLyricsTiming: { startedAt: 20_000 },
      asset: { finalArtifactId: "playable-video" },
      activities: [],
      timings: [],
    });

    expect(steps.find((step) => step.kind === "mux")?.state).toBe("completed");
    expect(steps.find((step) => step.kind === "transcribe")).toMatchObject({
      state: "running",
      startedAt: 20_000,
    });
  });
});
