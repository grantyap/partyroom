import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import { defaultRoomMemberPermissions } from "./rooms.schema";
import schema from "./schema";
import { modules } from "./test.setup";

describe("anonymous user data migration", () => {
  test("moves room activity and attribution to the registered account", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const now = 100;
      const roomId = await ctx.db.insert("rooms", {
        owner: "anonymous",
        name: "singing-otter",
        memberPermissions: defaultRoomMemberPermissions,
      });
      const jobId = await ctx.db.insert("mediaJobs", {
        requestKey: "request",
        encryptedSource: "source",
        sourceIv: "iv",
        requestedBy: "anonymous",
        state: "queued",
        stage: "queued",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      });
      const roomMediaId = await ctx.db.insert("roomMedia", {
        room: roomId,
        job: jobId,
        requestedBy: "anonymous",
        createdAt: now,
      });
      const visitId = await ctx.db.insert("roomVisits", {
        room: roomId,
        user: "anonymous",
        lastVisitedAt: now,
      });
      const messageId = await ctx.db.insert("messages", {
        room: roomId,
        user: "anonymous",
        body: "Hello",
        clientMessageId: "message",
      });
      const playbackId = await ctx.db.insert("roomPlayback", {
        room: roomId,
        state: {
          kind: "occupiedWaiting",
          occupancyGeneration: 1,
          presenceCheckAt: now + 30_000,
          queue: [
            {
              kind: "processing",
              key: "queue-item",
              roomMedia: roomMediaId,
              addedBy: "anonymous",
              createdAt: now,
            },
          ],
        },
        revision: 0,
        queueRevision: 0,
      });

      return { jobId, messageId, playbackId, roomMediaId, roomId, visitId };
    });

    await t.mutation(internal.userData.migrateUserData, {
      fromUserId: "anonymous",
      toUserId: "registered",
    });

    const migrated = await t.run(async (ctx) => ({
      job: await ctx.db.get("mediaJobs", ids.jobId),
      message: await ctx.db.get("messages", ids.messageId),
      playback: await ctx.db.get("roomPlayback", ids.playbackId),
      roomMedia: await ctx.db.get("roomMedia", ids.roomMediaId),
      visit: await ctx.db.get("roomVisits", ids.visitId),
    }));

    expect(migrated.job?.requestedBy).toBe("registered");
    expect(migrated.message?.user).toBe("registered");
    expect((await t.run((ctx) => ctx.db.get("rooms", ids.roomId)))?.owner).toBe("registered");
    expect(migrated.roomMedia?.requestedBy).toBe("registered");
    expect(migrated.visit?.user).toBe("registered");
    expect(migrated.playback?.state).toMatchObject({
      queue: [{ addedBy: "registered" }],
    });
  });

  test("merges duplicate room visits while preserving the latest timestamp", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const roomId = await ctx.db.insert("rooms", {
        owner: "owner",
        name: "singing-otter",
        memberPermissions: defaultRoomMemberPermissions,
      });
      const anonymousVisitId = await ctx.db.insert("roomVisits", {
        room: roomId,
        user: "anonymous",
        lastVisitedAt: 200,
      });
      const registeredVisitId = await ctx.db.insert("roomVisits", {
        room: roomId,
        user: "registered",
        lastVisitedAt: 100,
      });
      return { anonymousVisitId, registeredVisitId, roomId };
    });

    await t.mutation(internal.userData.migrateUserData, {
      fromUserId: "anonymous",
      toUserId: "registered",
    });

    const visits = await t.run(async (ctx) =>
      ctx.db
        .query("roomVisits")
        .withIndex("by_room", (q) => q.eq("room", ids.roomId))
        .take(2),
    );

    expect(await t.run((ctx) => ctx.db.get("roomVisits", ids.anonymousVisitId))).toBeNull();
    expect(visits).toEqual([
      expect.objectContaining({
        _id: ids.registeredVisitId,
        lastVisitedAt: 200,
        user: "registered",
      }),
    ]);
  });
});
