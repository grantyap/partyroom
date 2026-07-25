import { Presence } from "@convex-dev/presence";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRoomPermission } from "./rooms";
import { authComponent } from "./auth";

export const presence = new Presence(components.presence);

export const heartbeat = mutation({
  args: {
    room: v.id("rooms"),
    user: v.string(),
    session: v.string(),
    interval: v.number(),
  },
  handler: async (ctx, { room: roomId, user, session, interval }) => {
    const [room, roomMember] = await Promise.all([
      ctx.db.get("rooms", roomId).then((room) => {
        if (!room) {
          throw new Error("Room not found");
        }

        return room;
      }),
      ctx.db
        .query("roomMembers")
        .withIndex("by_room_user", (q) => q.eq("room", roomId).eq("user", user))
        .first(),
    ]);

    requireRoomPermission({ user, room, roomMember, permission: "rooms:read" });

    return await presence.heartbeat(ctx, roomId, user, session, interval);
  },
});

export const list = query({
  args: {
    roomToken: v.string(),
  },
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
  },
  handler: async (ctx, { sessionToken }) => {
    return await presence.disconnect(ctx, sessionToken);
  },
});
