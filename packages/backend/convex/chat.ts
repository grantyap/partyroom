import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent, getCurrentUserImpl } from "./auth";

export const getMessages = query({
  args: {
    room: v.id("rooms"),
  },
  handler: async (ctx, { room }) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_room", (q) => q.eq("room", room))
      .order("desc")
      .take(50)
      .then(async (messages) => {
        return await Promise.all(
          messages.map(async (message) => {
            const user = await authComponent.getAnyUserById(ctx, message.user);
            return {
              ...message,
              user: {
                _id: message.user,
                name: user?.name,
              },
            };
          }),
        );
      });
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
    const user = await getCurrentUserImpl(ctx);
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
