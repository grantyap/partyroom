import type { OperationKind } from "./validators";

export type PipelineStepKind = OperationKind | "fetchLyrics";

export const mediaPipelineSteps: readonly PipelineStepKind[] = [
  "resolve",
  "fetchLyrics",
  "download",
  "extractAudio",
  "separate",
  "transcribe",
  "analyzeMelody",
  "mux",
  "assembleAnnotations",
];

type ActivityProgress = {
  kind: OperationKind;
  state: string;
  progress?: number;
  message?: string;
  attempt?: number;
  startedAt?: number;
  completedAt?: number;
};

type ProgressAsset = {
  sourceArtifactId?: unknown;
  extractedAudioArtifactId?: unknown;
  instrumentalArtifactId?: unknown;
  vocalsArtifactId?: unknown;
  melodyArtifactId?: unknown;
  finalArtifactId?: unknown;
  annotationsState?: "processing" | "ready" | "failed";
};

export type PipelineStepState = "pending" | "queued" | "running" | "completed" | "failed";

export type PipelineStepStatus = {
  kind: PipelineStepKind;
  state: PipelineStepState;
  progress: number;
  message?: string;
  attempt?: number;
  startedAt?: number;
  completedAt?: number;
};

function stepStatus(
  status: Omit<PipelineStepStatus, "message" | "attempt" | "startedAt" | "completedAt">,
  activity?: ActivityProgress,
  timing?: { startedAt: number; completedAt?: number },
): PipelineStepStatus {
  return {
    ...status,
    ...(activity?.message !== undefined ? { message: activity.message } : {}),
    ...(activity?.attempt !== undefined ? { attempt: activity.attempt } : {}),
    ...(activity?.startedAt !== undefined
      ? { startedAt: activity.startedAt }
      : timing
        ? { startedAt: timing.startedAt }
        : {}),
    ...(activity?.completedAt !== undefined
      ? { completedAt: activity.completedAt }
      : timing?.completedAt !== undefined
        ? { completedAt: timing.completedAt }
        : {}),
  };
}

function completedSteps(
  hasAsset: boolean,
  hasGeneratedLyrics: boolean,
  asset: ProgressAsset | null,
) {
  const annotationsTerminal =
    asset?.annotationsState === "ready" || asset?.annotationsState === "failed";
  return new Set<PipelineStepKind>([
    ...(hasAsset ? (["resolve"] as const) : []),
    ...(asset?.sourceArtifactId ? (["download"] as const) : []),
    ...(asset?.extractedAudioArtifactId ? (["extractAudio"] as const) : []),
    ...(asset?.instrumentalArtifactId && asset.vocalsArtifactId ? (["separate"] as const) : []),
    ...(hasGeneratedLyrics ? (["transcribe"] as const) : []),
    ...(asset?.melodyArtifactId || asset?.annotationsState === "failed"
      ? (["analyzeMelody"] as const)
      : []),
    ...(asset?.finalArtifactId ? (["mux"] as const) : []),
    ...(annotationsTerminal ? (["assembleAnnotations"] as const) : []),
  ]);
}

export function mediaPipelineStepStatuses({
  hasAsset,
  hasGeneratedLyrics = false,
  lrclibLyricsState,
  lrclibLyricsTiming,
  asset,
  activities,
  timings,
}: {
  hasAsset: boolean;
  hasGeneratedLyrics?: boolean;
  lrclibLyricsState?: "processing" | "ready" | "not_found" | "failed";
  lrclibLyricsTiming?: { startedAt: number; completedAt?: number };
  asset: ProgressAsset | null;
  activities: ActivityProgress[];
  timings: Array<{
    kind: OperationKind;
    startedAt: number;
    completedAt: number;
  }>;
}): PipelineStepStatus[] {
  const completed = completedSteps(hasAsset, hasGeneratedLyrics, asset);
  const timingByKind = new Map(timings.map((timing) => [timing.kind, timing]));
  const activeByKind = new Map<OperationKind, ActivityProgress>();
  for (const activity of activities) {
    const existing = activeByKind.get(activity.kind);
    if (!existing || (activity.attempt ?? 0) >= (existing.attempt ?? 0)) {
      activeByKind.set(activity.kind, activity);
    }
  }

  return mediaPipelineSteps.map((kind) => {
    if (kind === "fetchLyrics") {
      if (lrclibLyricsState === "processing") {
        return stepStatus({ kind, state: "running", progress: 0 }, undefined, lrclibLyricsTiming);
      }
      if (lrclibLyricsState === "failed" || lrclibLyricsState === "not_found") {
        return stepStatus({ kind, state: "failed", progress: 1 }, undefined, lrclibLyricsTiming);
      }
      if (lrclibLyricsState === "ready") {
        return stepStatus({ kind, state: "completed", progress: 1 }, undefined, lrclibLyricsTiming);
      }
      return { kind, state: "pending", progress: 0 };
    }
    const activity = activeByKind.get(kind);
    const timing = timingByKind.get(kind);
    const annotationFailed =
      asset?.annotationsState === "failed" &&
      ((kind === "analyzeMelody" && !asset.melodyArtifactId) || kind === "assembleAnnotations");

    if (annotationFailed) {
      return stepStatus({ kind, state: "failed", progress: 1 }, activity, timing);
    }
    if (completed.has(kind) || activity?.state === "completed") {
      return stepStatus({ kind, state: "completed", progress: 1 }, activity, timing);
    }
    if (activity) {
      const state: PipelineStepState =
        activity.state === "running"
          ? "running"
          : activity.state === "failed" || activity.state === "canceled"
            ? "failed"
            : "queued";
      return stepStatus(
        {
          kind,
          state,
          progress: Math.min(1, Math.max(0, activity.progress ?? 0)),
        },
        activity,
        timing,
      );
    }
    return { kind, state: "pending", progress: 0 };
  });
}
