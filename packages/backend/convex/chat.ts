import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { capabilities } from "./capabilities";
import { requireRoomAction } from "./rooms";

const uuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      clientMessageId: v.string(),
      user: v.object({ _id: v.string(), name: v.optional(v.string()) }),
    }),
  ),
  handler: async (ctx, { room }) => {
    await requireRoomAction(ctx, room, capabilities.rooms.read);
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
    clientMessageId: v.string(),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    const { user } = await requireRoomAction(ctx, args.room, capabilities.rooms.chat);
    const body = args.body.trim();
    if (!body) throw new Error("Message cannot be empty");
    if (body.length > 500) throw new Error("Message is too long");
    const clientMessageId = args.clientMessageId.trim();
    if (!uuidV4Pattern.test(clientMessageId)) {
      throw new Error("Client message ID must be a UUIDv4");
    }
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_room_and_client_message_id", (q) =>
        q.eq("room", args.room).eq("clientMessageId", clientMessageId),
      )
      .unique();
    if (existing) {
      if (existing.user === user._id && existing.body === body) return existing._id;
      throw new Error("Client message ID is already in use");
    }
    return await ctx.db.insert("messages", {
      room: args.room,
      user: user._id,
      body,
      clientMessageId,
    });
  },
});
