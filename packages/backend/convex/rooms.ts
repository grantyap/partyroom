import { Infer, v } from "convex/values";
import { generateSlug } from "random-word-slugs";
import { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { authComponent, getCurrentUserImpl } from "./auth";
import { roomRoleSchema } from "./rooms.schema";

export const getRoomByName = query({
  args: {
    name: v.string(),
  },
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

    const roomMember = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_user", (q) => q.eq("room", room._id).eq("user", user._id))
      .first();
    const hasReadPermission = userHasRoomPermission({
      user: user._id,
      room,
      roomMember,
      permission: "rooms:read",
    });

    if (!hasReadPermission) {
      throw new Error("User not in room");
    }

    return room;
  },
});

export const getRooms = query({
  handler: async (ctx) => {
    const user = await getCurrentUserImpl(ctx);
    if (!user) {
      throw new Error("Unauthenticated");
    }

    const [ownedRooms, roomMemberRows] = await Promise.all([
      ctx.db
        .query("rooms")
        .withIndex("by_owner", (q) => q.eq("owner", user._id))
        .collect()
        .then((ownedRooms) =>
          ownedRooms.map((ownedRoom) => ({ ...ownedRoom, owner: { name: user.name } })),
        ),
      ctx.db
        .query("roomMembers")
        .withIndex("by_user", (q) => q.eq("user", user._id))
        .collect(),
    ]);
    const roomIdRoles = roomMemberRows.map((row) => [row.room, row.role] as const);

    const roomPromises = roomIdRoles.map(async ([roomId, role]) => {
      const room = await ctx.db.get("rooms", roomId);
      if (!room) {
        // This should never happen. When we get a list of `roomMembers`,
        // then its related `room` *must* exist.
        return null;
      }

      if (
        !userHasRoomPermission({
          user: user._id,
          room,
          roomMember: { role },
          permission: "rooms:read",
        })
      ) {
        return null;
      }

      const owner = await authComponent.getAnyUserById(ctx, room.owner);
      if (!owner) {
        // This should never happen. Every room must have a valid owner.
        return null;
      }

      return { ...room, owner: { name: owner.name } };
    });

    return await Promise.all(roomPromises).then((rooms) => [
      ...ownedRooms,
      ...rooms.filter(<T>(room: T | null): room is T => !!room),
    ]);
  },
});

export const createRoom = mutation({
  args: {
    members: v.optional(v.array(v.object({ user: v.string(), role: roomRoleSchema }))),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { members, name }) => {
    const user = await getCurrentUserImpl(ctx);
    if (!user) {
      throw new Error("Unauthenticated");
    }

    requireRoomPermission({ user: user._id, permission: "rooms:create" });

    const room = await ctx.db.insert("rooms", {
      owner: user._id,
      name: name || generateSlug(),
    });

    await Promise.all(
      (members ?? [])?.map(({ user, role }) => ctx.db.insert("roomMembers", { room, user, role })),
    );

    return room;
  },
});

const roomPermissionsKey = "rooms";
const roomActions = ["read", "create", "update", "delete", "chat"] as const;

type RoleRoomPermission = `${typeof roomPermissionsKey}:${(typeof roomActions)[number]}`;

export const roleRoomPermissions = {
  admin: ["rooms:read", "rooms:create", "rooms:update", "rooms:delete", "rooms:chat"],
  member: ["rooms:read", "rooms:chat"],
} as const satisfies Record<Infer<typeof roomRoleSchema>, RoleRoomPermission[]>;

function isUserRoomOwner(user: string, room: { owner: string }) {
  return room.owner === user;
}

export function userHasRoomPermission(
  opts: { user: string } & (
    | {
        room: Pick<Doc<"rooms">, "owner">;
        roomMember: Pick<Doc<"roomMembers">, "role"> | null;
        permission: Exclude<RoleRoomPermission, "rooms:create">;
      }
    | { room?: never; roomMember?: never; permission: "rooms:create" }
  ),
) {
  if (opts.permission === "rooms:create") {
    return true;
  }

  const isOwner = isUserRoomOwner(opts.user, opts.room);
  if (isOwner) {
    return true;
  }

  if (!opts.roomMember) {
    return false;
  }

  return (
    roleRoomPermissions[opts.roomMember.role] as Exclude<RoleRoomPermission, "room:create">[]
  ).includes(opts.permission);
}

export const requireRoomPermission = (...args: Parameters<typeof userHasRoomPermission>) => {
  if (!userHasRoomPermission(...args)) {
    throw new Error("Unauthorized");
  }
};
