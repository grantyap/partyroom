import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { requireRoomAction } from "./rooms";

export const getMessages = query({
  args: {
    room: v.id("rooms"),
  },
  returns: v.array(
    v.object({
      _id: v.id("messages"),
      _creationTime: v.number(),
      room: v.id("rooms"),
      body: v.string(),
      user: v.object({ _id: v.string(), name: v.optional(v.string()) }),
    }),
  ),
  handler: async (ctx, { room }) => {
    await requireRoomAction(ctx, room, "rooms:read");
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
    body: v.string(),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    const { user } = await requireRoomAction(ctx, args.room, "rooms:chat");
    const body = args.body.trim();
    if (!body) throw new Error("Message cannot be empty");
    if (body.length > 500) throw new Error("Message is too long");
    return await ctx.db.insert("messages", {
      room: args.room,
      user: user._id,
      body,
    });
  },
});
