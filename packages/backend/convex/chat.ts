import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

export const getMessage = query({
  args: {},
  handler: async (ctx) => {
    const messages = await ctx.db.query("messages").order("desc").take(50);
    return messages.reverse();
  },
});

export const sendMessage = mutation({
  args: {
    room: v.id("rooms"),
    user: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError("Unauthenticated");
    }

    await ctx.db.insert("messages", {
      room: args.room,
      user: user._id,
      body: args.body,
    });
  },
});
