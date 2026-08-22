import { Presence } from "@convex-dev/presence";
import { components, internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRoomAction } from "./rooms";
import { authComponent } from "./auth";

export const presence = new Presence(components.presence);

export const heartbeat = mutation({
  args: {
    room: v.id("rooms"),
    session: v.string(),
    interval: v.number(),
  },
  returns: v.object({ roomToken: v.string(), sessionToken: v.string() }),
  handler: async (ctx, { room: roomId, session, interval }) => {
    const { user } = await requireRoomAction(ctx, roomId, "rooms:read");
    const result = await presence.heartbeat(ctx, roomId, user._id, session, interval);
    await ctx.scheduler.runAfter(0, internal.playback.recordOccupied, { roomId });
    return result;
  },
});

export const list = query({
  args: {
    roomToken: v.string(),
  },
  returns: v.array(
    v.object({
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
      data: v.optional(v.any()),
      name: v.optional(v.string()),
      username: v.optional(v.union(v.string(), v.null())),
      image: v.optional(v.union(v.string(), v.null())),
    }),
  ),
  handler: async (ctx, { roomToken }) => {
    return await presence.list(ctx, roomToken).then(async (presenceUsers) => {
      const userPromises = presenceUsers.map(async (presenceUser) => {
        const user = await authComponent.getAnyUserById(ctx, presenceUser.userId);
        if (!user) {
          return null;
        }

        const { name, username, image } = user;
        return {
          ...presenceUser,
          name,
          username,
          image,
        };
      });

      const results = await Promise.all(userPromises);
      return results.filter(<T>(value: T | null): value is T => !!value);
    });
  },
});

export const disconnect = mutation({
  args: {
    sessionToken: v.string(),
    room: v.id("rooms"),
  },
  returns: v.null(),
  handler: async (ctx, { sessionToken, room }) => {
    await presence.disconnect(ctx, sessionToken);
    await ctx.scheduler.runAfter(0, internal.playback.observePresence, { roomId: room });
    return null;
  },
});
