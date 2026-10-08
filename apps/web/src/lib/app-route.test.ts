import { expect, test } from "bun:test";
import { capabilities } from "./capabilities";
import { load } from "../routes/app/+page.server";

test("app requires a registered user with permission to list rooms", async () => {
  const run = (user: unknown) =>
    load({ parent: async () => ({ user }) } as Parameters<typeof load>[0]);

  for (const user of [null, { isAnonymous: true, capabilities: [] }]) {
    await expect(run(user)).rejects.toMatchObject({
      status: 303,
      location: "/login?to=%2Fapp",
    });
  }

  await expect(run({ isAnonymous: false, capabilities: [] })).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    run({ isAnonymous: false, capabilities: [capabilities.rooms.list] }),
  ).resolves.toBeUndefined();
});
