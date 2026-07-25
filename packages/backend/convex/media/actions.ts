import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action } from "../_generated/server";
import { encryptSourceUrl, hashRequest } from "./crypto";

export const requestMedia = action({
  args: { roomId: v.id("rooms"), url: v.string() },
  handler: async (
    ctx,
    { roomId, url },
  ): Promise<{
    jobId: Id<"mediaJobs">;
    roomMediaId: Id<"roomMedia">;
    created: boolean;
  }> => {
    if (url.length > 8_192) throw new Error("Media URL is too long");
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only HTTP and HTTPS media URLs are accepted");
    }
    const requestedBy: string = await ctx.runQuery(internal.media.jobs.authorizeRequest, {
      roomId,
    });
    const [{ encryptedSource, sourceIv }, requestKey] = await Promise.all([
      encryptSourceUrl(url),
      hashRequest(url),
    ]);
    return await ctx.runMutation(internal.media.jobs.request, {
      roomId,
      requestedBy,
      requestKey,
      encryptedSource,
      sourceIv,
    });
  },
});
