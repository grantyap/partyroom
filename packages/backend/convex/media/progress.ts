import type { OperationKind } from "./validators";

export const mediaPipelineSteps: readonly OperationKind[] = [
  "resolve",
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
};

type ProgressAsset = {
  sourceStorageId?: unknown;
  extractedAudioStorageId?: unknown;
  instrumentalStorageId?: unknown;
  vocalsStorageId?: unknown;
  lyricsStorageId?: unknown;
  timedLyricsStorageId?: unknown;
  melodyStorageId?: unknown;
  finalStorageId?: unknown;
  annotationsState?: "processing" | "ready" | "failed";
};

function completedSteps(hasAsset: boolean, asset: ProgressAsset | null) {
  const annotationsTerminal =
    asset?.annotationsState === "ready" || asset?.annotationsState === "failed";
  return new Set<OperationKind>([
    ...(hasAsset ? (["resolve"] as const) : []),
    ...(asset?.sourceStorageId ? (["download"] as const) : []),
    ...(asset?.extractedAudioStorageId ? (["extractAudio"] as const) : []),
    ...(asset?.instrumentalStorageId && asset.vocalsStorageId ? (["separate"] as const) : []),
    ...(asset?.lyricsStorageId && asset.timedLyricsStorageId ? (["transcribe"] as const) : []),
    ...(asset?.melodyStorageId || asset?.annotationsState === "failed"
      ? (["analyzeMelody"] as const)
      : []),
    ...(asset?.finalStorageId ? (["mux"] as const) : []),
    ...(annotationsTerminal ? (["assembleAnnotations"] as const) : []),
  ]);
}

export function mediaPipelineProgress({
  jobState,
  hasAsset,
  asset,
  activities,
}: {
  jobState: string;
  hasAsset: boolean;
  asset: ProgressAsset | null;
  activities: ActivityProgress[];
}) {
  if (jobState === "ready") return 1;

  const completed = completedSteps(hasAsset, asset);
  const activeProgress = new Map<OperationKind, number>();
  for (const activity of activities) {
    if (activity.state === "completed") {
      activeProgress.set(activity.kind, 1);
      continue;
    }
    if (activity.state !== "running" || activity.progress === undefined) continue;
    activeProgress.set(
      activity.kind,
      Math.max(activeProgress.get(activity.kind) ?? 0, Math.min(1, Math.max(0, activity.progress))),
    );
  }

  const total = mediaPipelineSteps.reduce(
    (sum, kind) => sum + (completed.has(kind) ? 1 : (activeProgress.get(kind) ?? 0)),
    0,
  );
  return total / mediaPipelineSteps.length;
}
