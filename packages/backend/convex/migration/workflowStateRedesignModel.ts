type LegacyProjection = {
  stage?: unknown;
  progress?: unknown;
  activeActivities?: unknown;
  stepTimings?: unknown;
};

export function isLegacyProjection(value: LegacyProjection) {
  return (
    "stage" in value || "progress" in value || "activeActivities" in value || "stepTimings" in value
  );
}

export function mediaJobPatch(job: Record<string, unknown>) {
  if (!isLegacyProjection(job)) return undefined;
  const patch = {
    stage: undefined,
    progress: undefined,
    activeActivities: undefined,
    stepTimings: undefined,
  };
  switch (job.state) {
    case "queued":
      return patch;
    case "processing":
      return undefined;
    case "ready":
      if (!job.asset || !job.workflowId) throw new Error("ready job needs asset and workflowId");
      return patch;
    case "failed":
      if (!job.errorCode || !job.errorMessage)
        throw new Error("failed job needs errorCode and errorMessage");
      return patch;
    case "canceled":
      if (!job.errorMessage) throw new Error("canceled job needs errorMessage");
      return patch;
    default:
      throw new Error("unknown media job state");
  }
}

export function mediaEnrichmentPatch(enrichment: Record<string, unknown>) {
  if (!isLegacyProjection(enrichment)) return undefined;
  const patch = {
    activeActivities: undefined,
    stepTimings: undefined,
  };
  if (!enrichment.workflowId) throw new Error("legacy enrichment needs workflowId");
  switch (enrichment.state) {
    case "processing":
      return undefined;
    case "ready":
      return patch;
    case "failed":
    case "canceled":
      if (!enrichment.error) throw new Error(`${enrichment.state} enrichment needs error`);
      return patch;
    default:
      throw new Error("unknown media enrichment state");
  }
}
