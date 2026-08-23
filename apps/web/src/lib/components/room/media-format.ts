import type { MediaStep } from "./types";

const stageLabels: Record<string, string> = {
  resolve: "Resolve source",
  fetchLyrics: "Fetch synced lyrics",
  download: "Download source",
  extractAudio: "Extract audio",
  separate: "Separate stems",
  transcribe: "Transcribe lyrics",
  alignLyrics: "Align LRCLIB lyrics",
  analyzeMelody: "Analyze melody",
  mux: "Build final video",
  assembleAnnotations: "Assemble annotations",
};

export function stageLabel(stage: string) {
  return (
    stageLabels[stage] ??
    stage.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())
  );
}

export function statusLabel(status: string) {
  if (status === "running") return "Working";
  if (status === "queued") return "Queued";
  if (status === "completed") return "Done";
  if (status === "failed") return "Unavailable";
  if (status === "canceled") return "Canceled";
  if (status === "skipped") return "Not needed";
  return "Waiting";
}

export function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function stepTimingLabel(step: MediaStep, currentTime: number) {
  if (step.startedAt === undefined) return null;
  const elapsed = formatElapsed((step.completedAt ?? currentTime) - step.startedAt);
  if (step.state === "completed") return `Completed in ${elapsed}`;
  if (step.state === "failed") return `Stopped after ${elapsed}`;
  if (step.state === "running") return elapsed;
  return null;
}

export function mediaElapsed(
  steps: ReadonlyArray<MediaStep>,
  isProcessing: boolean,
  currentTime: number,
) {
  const startedSteps = steps.filter(
    (step): step is MediaStep & { startedAt: number } => step.startedAt !== undefined,
  );
  if (startedSteps.length === 0) return null;

  const startedAt = Math.min(...startedSteps.map((step) => step.startedAt));
  const completedAt = Math.max(...startedSteps.map((step) => step.completedAt ?? step.startedAt));
  return formatElapsed((isProcessing ? currentTime : completedAt) - startedAt);
}

export function formatDuration(seconds?: number) {
  if (!seconds) return null;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}
