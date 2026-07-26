import { describe, expect, test } from "vitest";
import { mediaPipelineProgress } from "./progress";

describe("media pipeline progress", () => {
  test("gives every pipeline step an equal share", () => {
    expect(
      mediaPipelineProgress({
        jobState: "processing",
        hasAsset: true,
        asset: {
          sourceArtifactId: "source",
          extractedAudioArtifactId: "audio",
          instrumentalArtifactId: "instrumental",
          vocalsArtifactId: "vocals",
        },
        activities: [],
      }),
    ).toBe(4 / 8);
  });

  test("uses granular activity progress within its step", () => {
    expect(
      mediaPipelineProgress({
        jobState: "processing",
        hasAsset: true,
        asset: null,
        activities: [{ kind: "download", state: "running", progress: 0.4 }],
      }),
    ).toBe((1 + 0.4) / 8);
  });

  test("adds progress from parallel activities", () => {
    expect(
      mediaPipelineProgress({
        jobState: "processing",
        hasAsset: true,
        asset: {
          sourceArtifactId: "source",
          extractedAudioArtifactId: "audio",
          instrumentalArtifactId: "instrumental",
          vocalsArtifactId: "vocals",
        },
        activities: [
          { kind: "transcribe", state: "running", progress: 0.5 },
          { kind: "analyzeMelody", state: "running", progress: 0.2 },
          { kind: "mux", state: "running", progress: 0.8 },
        ],
      }),
    ).toBe((4 + 0.5 + 0.2 + 0.8) / 8);
  });

  test("counts failed optional annotation work as finished", () => {
    expect(
      mediaPipelineProgress({
        jobState: "processing",
        hasAsset: true,
        asset: {
          sourceArtifactId: "source",
          extractedAudioArtifactId: "audio",
          instrumentalArtifactId: "instrumental",
          vocalsArtifactId: "vocals",
          lyricsArtifactId: "lyrics",
          timedLyricsArtifactId: "timed-lyrics",
          finalArtifactId: "video",
          annotationsState: "failed",
        },
        activities: [],
      }),
    ).toBe(1);
  });

  test("always reports a ready job as complete", () => {
    expect(
      mediaPipelineProgress({
        jobState: "ready",
        hasAsset: false,
        asset: null,
        activities: [],
      }),
    ).toBe(1);
  });
});
