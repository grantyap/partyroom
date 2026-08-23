import {
  defineActivity,
  defineActivityRegistry,
  defineQueue,
  wire,
  type WireSchema,
} from "@partyroom/activities";

const minute = 60_000;

export const mediaQueues = {
  media: defineQueue("media", {
    leaseDurationMs: 30_000,
    maxConcurrentActivities: 4,
  }),
  stems: defineQueue("stems", {
    leaseDurationMs: 30_000,
    maxConcurrentActivities: 1,
  }),
  lyrics: defineQueue("lyrics", {
    leaseDurationMs: 30_000,
    maxConcurrentActivities: 2,
  }),
  annotations: defineQueue("annotations", {
    leaseDurationMs: 30_000,
    maxConcurrentActivities: 1,
  }),
};

function activity<
  const Name extends string,
  const Version extends number,
  const Input extends WireSchema,
  const Output extends WireSchema,
  const Queue extends (typeof mediaQueues)[keyof typeof mediaQueues],
>(config: {
  name: Name;
  /**
   * Bump when this activity's worker-facing input, output, artifacts, or
   * observable behavior changes incompatibly. Workflow-only graph changes do
   * not require an activity version bump.
   */
  version: Version;
  queue: Queue;
  input: Input;
  output: Output;
  startToCloseTimeoutMs: number;
  nonRetryableErrorTypes?: string[];
}) {
  return Object.freeze({
    ...defineActivity({
      name: config.name,
      version: config.version,
      queue: config.queue,
      input: config.input,
      output: config.output,
      startToCloseTimeoutMs: config.startToCloseTimeoutMs,
      scheduleToCloseTimeoutMs: 6 * 60 * minute,
      retryPolicy: {
        maximumAttempts: 3,
        initialIntervalMs: 5_000,
        maximumIntervalMs: minute,
        nonRetryableErrorTypes: config.nonRetryableErrorTypes ?? [],
      },
    }),
  });
}

export const mediaActivities = {
  resolve: activity({
    name: "media.resolve",
    version: 1,
    queue: mediaQueues.media,
    input: wire.object({ jobId: wire.string }),
    output: wire.object({
      extractor: wire.string,
      sourceId: wire.string,
      title: wire.optional(wire.string),
      duration: wire.optional(wire.number),
      track: wire.optional(wire.string),
      artist: wire.optional(wire.string),
      album: wire.optional(wire.string),
    }),
    startToCloseTimeoutMs: 5 * minute,
    nonRetryableErrorTypes: ["UnsupportedMedia", "MediaTooLong"],
  }),
  download: activity({
    name: "media.download",
    version: 2,
    queue: mediaQueues.media,
    input: wire.object({ jobId: wire.string }),
    output: wire.object({
      artifactId: wire.artifact("intermediate"),
      duration: wire.number,
      fileName: wire.string,
      contentType: wire.string,
    }),
    startToCloseTimeoutMs: 30 * minute,
  }),
  extractAudio: activity({
    name: "media.extractAudio",
    version: 2,
    queue: mediaQueues.media,
    input: wire.object({ sourceUrl: wire.string }),
    output: wire.object({
      artifactId: wire.artifact("intermediate"),
      duration: wire.number,
      contentType: wire.string,
    }),
    startToCloseTimeoutMs: 30 * minute,
  }),
  separate: activity({
    name: "media.separate",
    version: 2,
    queue: mediaQueues.stems,
    input: wire.object({ audioUrl: wire.string }),
    output: wire.object({
      instrumentalArtifactId: wire.artifact("retained"),
      // The durable enrichment workflow may consume vocals after the core
      // media workflow has completed and released its intermediate artifacts.
      vocalsArtifactId: wire.artifact("retained"),
      contentType: wire.string,
      model: wire.string,
    }),
    startToCloseTimeoutMs: 60 * minute,
  }),
  transcribe: activity({
    name: "media.transcribe",
    version: 2,
    queue: mediaQueues.lyrics,
    input: wire.object({ audioUrl: wire.string }),
    output: wire.object({
      lyricsArtifactId: wire.artifact("retained"),
      timedLyricsArtifactId: wire.artifact("retained"),
      contentType: wire.string,
      model: wire.string,
      language: wire.optional(wire.string),
    }),
    startToCloseTimeoutMs: 60 * minute,
  }),
  alignLyrics: activity({
    name: "media.alignLyrics",
    version: 4,
    queue: mediaQueues.lyrics,
    input: wire.object({
      audioUrl: wire.string,
      lines: wire.array(wire.string),
      lineStarts: wire.array(wire.number),
      lineEnds: wire.array(wire.number),
    }),
    output: wire.object({
      timedLyricsArtifactId: wire.artifact("retained"),
      contentType: wire.string,
      model: wire.string,
      language: wire.string,
    }),
    startToCloseTimeoutMs: 60 * minute,
  }),
  analyzeMelody: activity({
    name: "media.analyzeMelody",
    version: 2,
    queue: mediaQueues.annotations,
    input: wire.object({ audioUrl: wire.string }),
    output: wire.object({
      artifactId: wire.artifact("intermediate"),
      contentType: wire.string,
      model: wire.string,
    }),
    startToCloseTimeoutMs: 60 * minute,
  }),
  assembleAnnotations: activity({
    name: "media.assembleAnnotations",
    version: 2,
    queue: mediaQueues.annotations,
    input: wire.object({
      lyricsUrl: wire.string,
      melodyUrl: wire.string,
      duration: wire.number,
      extractor: wire.string,
      sourceId: wire.string,
      title: wire.optional(wire.string),
    }),
    output: wire.object({
      annotationsArtifactId: wire.artifact("retained"),
      midiArtifactId: wire.artifact("retained"),
      musicXmlArtifactId: wire.artifact("retained"),
      contentType: wire.string,
    }),
    startToCloseTimeoutMs: 15 * minute,
  }),
  mux: activity({
    name: "media.mux",
    version: 2,
    queue: mediaQueues.media,
    input: wire.object({ videoUrl: wire.string, instrumentalUrl: wire.string }),
    output: wire.object({
      artifactId: wire.artifact("retained"),
      duration: wire.number,
      contentType: wire.string,
    }),
    startToCloseTimeoutMs: 30 * minute,
  }),
};

export const mediaActivityRegistry = defineActivityRegistry({
  queues: mediaQueues,
  activities: mediaActivities,
});
