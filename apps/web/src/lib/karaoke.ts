import z from "zod";

export type LyricObservation = {
  time: number;
  duration: number;
  value: string;
  confidence?: number;
};

export type LyricsTiming = "word" | "line";

export type LyricsTrack = {
  id: string;
  label: string;
  title?: string | null;
  timing: LyricsTiming;
  suggestedOffsetMs?: number;
  content: { kind: "url"; url: string } | { kind: "inline"; observations: LyricObservation[] };
  captionsUrl?: string | null;
};

export type KaraokeWord = {
  time: number;
  duration: number;
  text: string;
};

export type KaraokeCue = {
  start: number;
  end: number;
  words: KaraokeWord[];
};

export type MidiNoteObservation = {
  time: number;
  duration: number;
  value: number;
  confidence?: number;
};

export type PitchContourObservation = {
  time: number;
  duration: number;
  value: {
    index: number;
    frequency: number;
    voiced: boolean;
  };
  confidence?: number;
};

export type BeatObservation = {
  time: number;
  duration: number;
  value: number | null;
};

export type BeatPositionObservation = {
  time: number;
  duration: number;
  value: {
    position: number;
    measure: number;
    num_beats: number;
    beat_units: 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256;
  };
};

export type LabelObservation = {
  time: number;
  duration: number;
  value: string;
};

export type TempoObservation = {
  time: number;
  duration: number;
  value: number;
  confidence?: number;
};

const finiteNonNegative = z.number().finite().nonnegative();
const sandboxSchema = z.record(z.string(), z.unknown());

const jamsObservationSchema = z
  .object({
    time: finiteNonNegative,
    duration: finiteNonNegative,
    value: z.unknown(),
    confidence: z.unknown().optional(),
  })
  .passthrough();

const denseJamsDataSchema = z
  .object({
    time: z.array(finiteNonNegative),
    duration: z.array(finiteNonNegative),
    value: z.array(z.unknown()),
    confidence: z.array(z.unknown()),
  })
  .superRefine((data, context) => {
    const lengths = [
      data.time.length,
      data.duration.length,
      data.value.length,
      data.confidence.length,
    ];
    if (!lengths.every((length) => length === lengths[0])) {
      context.addIssue({
        code: "custom",
        message: "Dense JAMS annotation columns must have equal lengths",
      });
    }
  })
  .transform(({ time, duration, value, confidence }): JamsObservation[] =>
    time.map((observationTime, index) => ({
      time: observationTime,
      duration: duration[index],
      value: value[index],
      confidence: confidence[index],
    })),
  );

const jamsAnnotationMetadataSchema = z
  .object({
    corpus: z.string().nullish(),
    version: z.union([z.string(), z.number()]).nullish(),
    curator: z
      .object({
        name: z.string(),
        email: z.string(),
      })
      .passthrough()
      .nullish(),
    annotator: sandboxSchema.nullish(),
    annotation_tools: z.string().nullish(),
    annotation_rules: z.string().nullish(),
    validation: z.string().nullish(),
    data_source: z.string().nullish(),
  })
  .passthrough();

const jamsAnnotationSchema = z
  .object({
    namespace: z.string().min(1),
    data: z.union([z.array(jamsObservationSchema), denseJamsDataSchema]),
    annotation_metadata: jamsAnnotationMetadataSchema.nullish(),
    sandbox: sandboxSchema.optional(),
    time: finiteNonNegative.nullish(),
    duration: finiteNonNegative.nullish(),
  })
  .passthrough();

const jamsFileMetadataSchema = z
  .object({
    identifiers: sandboxSchema,
    artist: z.string(),
    title: z.string(),
    release: z.string(),
    duration: finiteNonNegative.nullish(),
    jams_version: z.string(),
  })
  .passthrough();

export const jamsDocumentSchema = z
  .object({
    file_metadata: jamsFileMetadataSchema,
    annotations: z.array(jamsAnnotationSchema),
    sandbox: sandboxSchema,
  })
  .passthrough();

export type JamsObservation = z.infer<typeof jamsObservationSchema>;
export type JamsAnnotationMetadata = z.infer<typeof jamsAnnotationMetadataSchema>;
export type JamsAnnotation = z.infer<typeof jamsAnnotationSchema>;
export type JamsFileMetadata = z.infer<typeof jamsFileMetadataSchema>;
export type JamsDocument = z.infer<typeof jamsDocumentSchema>;

export type KaraokeAnnotationTrack<Observation> = {
  namespace: string;
  data: Observation[];
  annotation_metadata?: JamsAnnotationMetadata | null;
  sandbox?: Record<string, unknown>;
  time?: number | null;
  duration?: number | null;
};

export type KaraokeJamsDocument = {
  jams: JamsDocument;
  lyrics: KaraokeAnnotationTrack<LyricObservation>[];
  midiNotes: KaraokeAnnotationTrack<MidiNoteObservation>[];
  pitchContours: KaraokeAnnotationTrack<PitchContourObservation>[];
  beats: KaraokeAnnotationTrack<BeatObservation>[];
  beatPositions: KaraokeAnnotationTrack<BeatPositionObservation>[];
  segments: KaraokeAnnotationTrack<LabelObservation>[];
  tempos: KaraokeAnnotationTrack<TempoObservation>[];
  keys: KaraokeAnnotationTrack<LabelObservation>[];
  chords: KaraokeAnnotationTrack<LabelObservation>[];
};

const numericConfidence = z
  .unknown()
  .transform((confidence) =>
    typeof confidence === "number" && Number.isFinite(confidence) ? confidence : undefined,
  );

const lyricObservationSchema = z
  .object({
    time: finiteNonNegative,
    duration: finiteNonNegative,
    value: z.string().trim().min(1),
    confidence: numericConfidence.optional(),
  })
  .transform(
    ({ time, duration, value, confidence }): LyricObservation => ({
      time,
      duration,
      value,
      ...(confidence === undefined ? {} : { confidence }),
    }),
  );

const displayLyricObservationSchema = lyricObservationSchema.refine(({ duration }) => duration > 0);

function tolerantArray<Output>(schema: z.ZodType<Output>) {
  return z
    .array(z.union([schema, z.unknown().transform(() => null)]))
    .transform((observations) =>
      observations.filter((observation): observation is Output => observation !== null),
    );
}

const directLyricObservationsSchema = tolerantArray(displayLyricObservationSchema);

const directLyricsSchema = z
  .object({ observations: directLyricObservationsSchema })
  .transform(({ observations }) => observations);

const midiNoteObservationSchema = z
  .object({
    time: finiteNonNegative,
    duration: finiteNonNegative,
    value: z.number().finite(),
    confidence: numericConfidence.optional(),
  })
  .transform(
    ({ time, duration, value, confidence }): MidiNoteObservation => ({
      time,
      duration,
      value,
      ...(confidence === undefined ? {} : { confidence }),
    }),
  );

const pitchContourObservationSchema = z
  .object({
    time: finiteNonNegative,
    duration: finiteNonNegative,
    value: z.object({
      index: z.number().int().nonnegative(),
      frequency: finiteNonNegative,
      voiced: z.boolean(),
    }),
    confidence: numericConfidence.optional(),
  })
  .transform(
    ({ time, duration, value, confidence }): PitchContourObservation => ({
      time,
      duration,
      value,
      ...(confidence === undefined ? {} : { confidence }),
    }),
  );

const beatObservationSchema = z
  .object({
    time: finiteNonNegative,
    duration: finiteNonNegative,
    value: z.number().finite().nullable(),
  })
  .transform(({ time, duration, value }): BeatObservation => ({ time, duration, value }));

const beatPositionObservationSchema = z
  .object({
    time: finiteNonNegative,
    duration: finiteNonNegative,
    value: z.object({
      position: z.number().finite().min(1),
      measure: z.number().int().nonnegative(),
      num_beats: z.number().int().positive(),
      beat_units: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(4),
        z.literal(8),
        z.literal(16),
        z.literal(32),
        z.literal(64),
        z.literal(128),
        z.literal(256),
      ]),
    }),
  })
  .transform(({ time, duration, value }): BeatPositionObservation => ({ time, duration, value }));

const labelObservationSchema = z
  .object({
    time: finiteNonNegative,
    duration: finiteNonNegative,
    value: z.string().trim().min(1),
  })
  .transform(({ time, duration, value }): LabelObservation => ({ time, duration, value }));

const tempoObservationSchema = z
  .object({
    time: finiteNonNegative,
    duration: finiteNonNegative,
    value: finiteNonNegative,
    confidence: z.number().finite().min(0).max(1).nullish(),
  })
  .transform(
    ({ time, duration, value, confidence }): TempoObservation => ({
      time,
      duration,
      value,
      ...(confidence === null || confidence === undefined ? {} : { confidence }),
    }),
  );

function tracksFor<Observation>(
  jams: JamsDocument,
  namespaces: readonly string[],
  observationSchema: z.ZodType<Observation>,
): KaraokeAnnotationTrack<Observation>[] {
  return jams.annotations.flatMap((annotation) => {
    if (!namespaces.includes(annotation.namespace)) return [];
    const data = tolerantArray(observationSchema).parse(annotation.data);
    return [{ ...annotation, data }];
  });
}

export function parseJamsDocument(value: unknown): JamsDocument | null {
  const parsed = jamsDocumentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseKaraokeJams(value: unknown): KaraokeJamsDocument | null {
  const jams = parseJamsDocument(value);
  if (!jams) return null;

  return {
    jams,
    lyrics: tracksFor(jams, ["lyrics"], lyricObservationSchema),
    midiNotes: tracksFor(jams, ["note_midi"], midiNoteObservationSchema),
    pitchContours: tracksFor(jams, ["pitch_contour"], pitchContourObservationSchema),
    beats: tracksFor(jams, ["beat"], beatObservationSchema),
    beatPositions: tracksFor(jams, ["beat_position"], beatPositionObservationSchema),
    segments: tracksFor(jams, ["segment_open"], labelObservationSchema),
    tempos: tracksFor(jams, ["tempo"], tempoObservationSchema),
    keys: tracksFor(jams, ["key_mode"], labelObservationSchema),
    chords: tracksFor(jams, ["chord", "chord_harte"], labelObservationSchema),
  };
}

const displayLyricObservationsSchema = z
  .array(z.union([lyricObservationSchema, z.unknown().transform(() => null)]))
  .transform((observations) =>
    observations.filter(
      (observation): observation is LyricObservation =>
        observation !== null && observation.duration > 0,
    ),
  );

export function parseLyricObservations(value: unknown): LyricObservation[] {
  const direct = directLyricsSchema.safeParse(value);
  const observations = direct.success
    ? direct.data
    : (parseKaraokeJams(value)?.lyrics.find(({ data }) => data.length > 0)?.data ?? []);
  return displayLyricObservationsSchema
    .parse(observations)
    .sort((left, right) => left.time - right.time);
}

const endsSentence = (text: string) => /[.!?…]["')\]]?$/.test(text);

function wordLyricsIntoCues(
  observations: LyricObservation[],
  {
    maxCharacters = 44,
    maxDuration = 7.5,
    maxGap = 1.25,
  }: {
    maxCharacters?: number;
    maxDuration?: number;
    maxGap?: number;
  } = {},
): KaraokeCue[] {
  const cues: KaraokeCue[] = [];
  let words: KaraokeWord[] = [];

  const flush = () => {
    if (words.length === 0) return;
    const last = words.at(-1)!;
    cues.push({
      start: words[0].time,
      end: last.time + last.duration,
      words,
    });
    words = [];
  };

  for (const observation of observations) {
    const word: KaraokeWord = {
      time: observation.time,
      duration: observation.duration,
      text: observation.value,
    };
    const first = words[0];
    const previous = words.at(-1);
    const characterCount =
      words.reduce((total, current) => total + current.text.length, 0) +
      Math.max(0, words.length) +
      word.text.length;
    const shouldBreak =
      !!previous &&
      (observation.time - (previous.time + previous.duration) > maxGap ||
        observation.time + observation.duration - first.time > maxDuration ||
        characterCount > maxCharacters ||
        (endsSentence(previous.text) && words.length >= 3));

    if (shouldBreak) flush();
    words.push(word);
  }
  flush();
  return cues;
}

export function lyricsIntoCues(
  observations: LyricObservation[],
  timing: LyricsTiming,
): KaraokeCue[] {
  if (timing === "word") return wordLyricsIntoCues(observations);
  return observations
    .filter(
      ({ time, duration, value }) =>
        Number.isFinite(time) &&
        time >= 0 &&
        Number.isFinite(duration) &&
        duration > 0 &&
        value.trim(),
    )
    .sort((left, right) => left.time - right.time)
    .map(({ time, duration, value }) => ({
      start: time,
      end: time + duration,
      words: [{ time, duration, text: value.trim() }],
    }));
}

export function findKaraokeCue(cues: KaraokeCue[], currentTime: number): number {
  if (cues.length === 0 || !Number.isFinite(currentTime)) return -1;
  for (let index = cues.length - 1; index >= 0; index -= 1) {
    const cue = cues[index];
    if (currentTime >= cue.start && currentTime < cue.end) return index;
  }
  return -1;
}

export function karaokeWordProgress(word: KaraokeWord, currentTime: number): number {
  return Math.min(1, Math.max(0, (currentTime - word.time) / word.duration));
}
