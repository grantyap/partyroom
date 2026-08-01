import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

export async function getLyricTrack(
  ctx: Pick<QueryCtx, "db">,
  assetId: Id<"mediaAssets">,
  source: string,
) {
  return await ctx.db
    .query("mediaLyricTracks")
    .withIndex("by_asset_and_source", (q) => q.eq("asset", assetId).eq("source", source))
    .unique();
}
