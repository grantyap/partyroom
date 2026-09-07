import { v } from "convex/values";
import { generateSlug } from "random-word-slugs";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { authComponent, getCurrentUserImpl } from "./auth";
import {
	capabilities,
	requireCapability,
	type RoomPermission,
} from "./capabilities";
import { defaultRoomMemberPermissions, roomMemberPermissionsSchema } from "./rooms.schema";

const roomDocSchema = v.object({
  _id: v.id("rooms"),
  _creationTime: v.number(),
  owner: v.string(),
  name: v.string(),
  memberPermissions: roomMemberPermissionsSchema,
});

const listedRoomFields = {
  _id: v.id("rooms"),
  _creationTime: v.number(),
  owner: v.object({ name: v.optional(v.string()) }),
  name: v.string(),
  memberPermissions: roomMemberPermissionsSchema,
};

const listedRoomSchema = v.object(listedRoomFields);
const recentRoomSchema = v.object({ ...listedRoomFields, lastVisitedAt: v.number() });
const roomMemberPermissionByCapability = {
  [capabilities.rooms.controlPlayback]: "controlPlayback",
  [capabilities.rooms.addToQueue]: "addToQueue",
  [capabilities.rooms.reorderQueue]: "reorderQueue",
  [capabilities.rooms.removeFromQueue]: "removeFromQueue",
  [capabilities.rooms.chat]: "sendChat",
} as const;

export const getRoomByName = query({
  args: {
    name: v.string(),
  },
  returns: roomDocSchema,
  handler: async (ctx, { name }) => {
    const user = await getCurrentUserImpl(ctx);
    if (!user) {
      throw new Error("Unauthenticated");
    }
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();
    if (!room) {
      throw new Error("Room not found");
    }

    return {
      ...room,
      memberPermissions: room.memberPermissions ?? defaultRoomMemberPermissions,
    };
  },
});

export const getRooms = query({
  args: {},
  returns: v.array(listedRoomSchema),
  handler: async (ctx) => {
    const user = await getCurrentUserImpl(ctx);
    if (!user) {
      throw new Error("Unauthenticated");
    }
    requireCapability(user, capabilities.rooms.list);

    return await ctx.db
      .query("rooms")
      .withIndex("by_owner", (q) => q.eq("owner", user._id))
      .take(200)
      .then((ownedRooms) =>
        ownedRooms.map((ownedRoom) => ({
          ...ownedRoom,
          memberPermissions: ownedRoom.memberPermissions ?? defaultRoomMemberPermissions,
          owner: { name: user.name },
        })),
      );
  },
});

export const getRecentRooms = query({
  args: {},
  returns: v.array(recentRoomSchema),
  handler: async (ctx) => {
    const user = await getCurrentUserImpl(ctx);
    if (!user) {
      throw new Error("Unauthenticated");
    }
    requireCapability(user, capabilities.rooms.list);

    const visits = await ctx.db
      .query("roomVisits")
      .withIndex("by_user_and_last_visited_at", (q) => q.eq("user", user._id))
      .order("desc")
      .take(20);
    const rooms = await Promise.all(
      visits.map(async (visit) => {
        const room = await ctx.db.get("rooms", visit.room);
        if (!room || room.owner === user._id) return null;
        const owner = await authComponent.getAnyUserById(ctx, room.owner);
        if (!owner) return null;
        return {
          ...room,
          memberPermissions: room.memberPermissions ?? defaultRoomMemberPermissions,
          owner: { name: owner.name },
          lastVisitedAt: visit.lastVisitedAt,
        };
      }),
    );
    return rooms.filter(<T>(room: T | null): room is T => room !== null);
  },
});

export const recordRoomVisitByName = mutation({
  args: { name: v.string() },
  returns: roomDocSchema,
  handler: async (ctx, { name }) => {
    const user = await getCurrentUserImpl(ctx);
    if (!user) {
      throw new Error("Unauthenticated");
    }

    return await recordRoomVisitByNameForUser(ctx, name, user._id);
  },
});

export async function recordRoomVisitByNameForUser(
  ctx: MutationCtx,
  name: string,
  userId: string,
  now = Date.now(),
) {
  const room = await ctx.db
    .query("rooms")
    .withIndex("by_name", (q) => q.eq("name", name))
    .first();
  if (!room) {
    throw new Error("Room not found");
  }

  if (room.owner !== userId) {
    const visit = await ctx.db
      .query("roomVisits")
      .withIndex("by_room_and_user", (q) => q.eq("room", room._id).eq("user", userId))
      .first();
    if (visit) {
      await ctx.db.patch("roomVisits", visit._id, { lastVisitedAt: now });
    } else {
      await ctx.db.insert("roomVisits", { room: room._id, user: userId, lastVisitedAt: now });
    }
  }

  return {
    ...room,
    memberPermissions: room.memberPermissions ?? defaultRoomMemberPermissions,
  };
}

export const createRoom = mutation({
  args: {
    name: v.optional(v.string()),
    memberPermissions: v.optional(roomMemberPermissionsSchema),
  },
  returns: v.object({ id: v.id("rooms"), name: v.string() }),
  handler: async (ctx, { name, memberPermissions }) => {
    const user = await getCurrentUserImpl(ctx);
    if (!user) {
      throw new Error("Unauthenticated");
    }

    requireCapability(user, capabilities.rooms.create);

    const roomName = name || generateSlug();
    const room = await ctx.db.insert("rooms", {
      owner: user._id,
      name: roomName,
      memberPermissions: memberPermissions ?? defaultRoomMemberPermissions,
    });

    const now = Date.now();
    await ctx.db.insert("roomPlayback", {
      room,
      state: {
        kind: "empty",
        emptySince: now,
        occupancyGeneration: 0,
        transport: { kind: "idle" },
        queue: [],
      },
      revision: 0,
      queueRevision: 0,
    });
    await ctx.scheduler.runAfter(10 * 60_000, internal.playback.deleteIfEmpty, {
      roomId: room,
      occupancyGeneration: 0,
    });

    return { id: room, name: roomName };
  },
});

export const updateMemberPermissions = mutation({
  args: {
    roomId: v.id("rooms"),
    memberPermissions: roomMemberPermissionsSchema,
  },
  returns: v.null(),
  handler: async (ctx, { roomId, memberPermissions }) => {
    await requireRoomAction(ctx, roomId, capabilities.rooms.update);
    await ctx.db.patch("rooms", roomId, { memberPermissions });
    return null;
  },
});

export function userHasRoomPermission(
  opts: {
    user: string;
    room: Pick<Doc<"rooms">, "owner" | "memberPermissions">;
    permission: RoomPermission;
  },
) {
  if (opts.room.owner === opts.user) {
    return true;
  }

  if (opts.permission === capabilities.rooms.read) {
    return true;
  }

  const setting =
    roomMemberPermissionByCapability[
      opts.permission as keyof typeof roomMemberPermissionByCapability
    ];
  return setting ? (opts.room.memberPermissions ?? defaultRoomMemberPermissions)[setting] : false;
}

export const requireRoomPermission = (...args: Parameters<typeof userHasRoomPermission>) => {
  if (!userHasRoomPermission(...args)) {
    throw new Error("Unauthorized");
  }
};

export async function requireRoomAction(
  ctx: QueryCtx | MutationCtx,
  roomId: Doc<"rooms">["_id"],
  permission: RoomPermission,
) {
  const user = await getCurrentUserImpl(ctx);
  if (!user) throw new Error("Unauthenticated");
  const room = await ctx.db.get("rooms", roomId);
  if (!room) throw new Error("Room not found");
  requireRoomPermission({ user: user._id, room, permission });
  return { room, user };
}
