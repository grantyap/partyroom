import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import {
  recordRoomVisitByNameForUser,
  userHasRoomPermission,
} from "./rooms";
import {
  capabilities,
  getCapabilities,
  requireCapability,
} from "./capabilities";
import { defaultRoomMemberPermissions } from "./rooms.schema";
import schema from "./schema";
import { modules } from "./test.setup";

const room = {
  owner: "owner",
  memberPermissions: defaultRoomMemberPermissions,
};

describe("room permissions without persistent membership", () => {
  test("gives registered users list and create capabilities", () => {
    expect(getCapabilities({ isAnonymous: false })).toEqual([
      capabilities.rooms.list,
      capabilities.rooms.create,
    ]);
  });

  test("does not give anonymous or unauthenticated users the room list capability", () => {
    expect(getCapabilities({ isAnonymous: true })).toEqual([]);
    expect(getCapabilities(null)).toEqual([]);
  });

  test("enforces registered-only capabilities", () => {
    expect(() => requireCapability({ isAnonymous: true }, capabilities.rooms.list)).toThrow(
      "Unauthorized",
    );
    expect(() => requireCapability({ isAnonymous: false }, capabilities.rooms.create)).not.toThrow();
  });

  test("allows any authenticated visitor to read a room", () => {
    expect(
      userHasRoomPermission({ user: "visitor", room, permission: capabilities.rooms.read }),
    ).toBe(true);
  });

  test("applies room-configured permissions to visitors", () => {
    expect(
      userHasRoomPermission({ user: "visitor", room, permission: capabilities.rooms.addToQueue }),
    ).toBe(true);
    expect(
      userHasRoomPermission({
        user: "visitor",
        room,
        permission: capabilities.rooms.controlPlayback,
      }),
    ).toBe(false);
  });

  test("does not allow visitors to change room settings", () => {
    expect(
      userHasRoomPermission({ user: "visitor", room, permission: capabilities.rooms.update }),
    ).toBe(false);
  });

  test("gives the owner every room permission", () => {
    expect(
      userHasRoomPermission({ user: "owner", room, permission: capabilities.rooms.update }),
    ).toBe(true);
    expect(
      userHasRoomPermission({ user: "owner", room, permission: capabilities.rooms.controlPlayback }),
    ).toBe(true);
  });
});

async function seedRoom(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    ctx.db.insert("rooms", {
      owner: "owner",
      name: "singing-otter",
      memberPermissions: defaultRoomMemberPermissions,
    }),
  );
}

describe("recent room visits", () => {
  test("records a non-owner visit", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);

    const visitedRoom = await t.run((ctx) =>
      recordRoomVisitByNameForUser(ctx, "singing-otter", "visitor", 100),
    );
    const visits = await t.run((ctx) =>
      ctx.db
        .query("roomVisits")
        .withIndex("by_room_and_user", (q) => q.eq("room", roomId).eq("user", "visitor"))
        .take(2),
    );

    expect(visitedRoom._id).toBe(roomId);
    expect(visits).toHaveLength(1);
    expect(visits[0]?.lastVisitedAt).toBe(100);
  });

  test("updates the existing visit instead of duplicating it", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);

    await t.run((ctx) => recordRoomVisitByNameForUser(ctx, "singing-otter", "visitor", 100));
    await t.run((ctx) => recordRoomVisitByNameForUser(ctx, "singing-otter", "visitor", 200));
    const visits = await t.run((ctx) =>
      ctx.db
        .query("roomVisits")
        .withIndex("by_room_and_user", (q) => q.eq("room", roomId).eq("user", "visitor"))
        .take(2),
    );

    expect(visits).toHaveLength(1);
    expect(visits[0]?.lastVisitedAt).toBe(200);
  });

  test("does not record owner visits", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);

    await t.run((ctx) => recordRoomVisitByNameForUser(ctx, "singing-otter", "owner", 100));
    const visits = await t.run((ctx) =>
      ctx.db
        .query("roomVisits")
        .withIndex("by_room", (q) => q.eq("room", roomId))
        .take(1),
    );

    expect(visits).toEqual([]);
  });
});
