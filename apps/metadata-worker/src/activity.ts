import { ApplicationError, defineHandler } from "@partyroom/activity-worker";
import { mediaActivities } from "@partyroom/media-activities";
import { resolve } from "node:path";
import { z } from "zod";
import { inputSchema, type MetadataInput } from "./model";

export const processResultSchema = z.object({
  metadata: z.object({
    artistName: z.string().trim().min(1).max(200).optional(),
    trackName: z.string().trim().min(1).max(200).optional(),
  }),
  inference: z.object({
    device: z.enum(["cpu", "metal", "cuda"]),
    model: z.string(),
    sizeBytes: z.number().positive(),
    gpuBytes: z.number().nonnegative(),
  }),
});

export function inferenceCommand(mode: "prepare" | "verify" | "extract", input?: MetadataInput) {
  const script = resolve(
    import.meta.dir,
    import.meta.file.endsWith(".ts") ? "inference.ts" : "inference.js",
  );
  const command = [process.execPath, script, mode, ...(input ? [JSON.stringify(input)] : [])];
  const lock = process.env.ACTIVITY_PROCESS_LOCK_PATH;
  return lock && mode !== "prepare" ? ["flock", "--no-fork", lock, ...command] : command;
}

export const extractMetadataActivity = defineHandler(
  mediaActivities.extractMetadata,
  async (context, input) => {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success)
      throw new ApplicationError("Invalid metadata input", "InvalidMetadata", true);
    await context.reportProgress(0, "Identifying song artist and title");
    const result = await context.runProcess(inferenceCommand("extract", parsed.data), {
      terminateTimeoutMs: 10_000,
    });
    const { metadata } = processResultSchema.parse(JSON.parse(result.stdout));
    await context.reportProgress(1, "Song metadata extracted");
    return metadata;
  },
);
