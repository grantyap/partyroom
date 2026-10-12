import { expect, test } from "bun:test";
import { load } from "../routes/app/settings/+page.server";

test("Settings requires a registered user and preserves return query parameters", async () => {
  const run = (user: unknown) =>
    load({
      parent: async () => ({ user }),
      url: new URL("https://partyroom.invalid/app/settings?verification=success"),
    } as Parameters<typeof load>[0]);
  for (const user of [null, { isAnonymous: true }]) {
    await expect(run(user)).rejects.toMatchObject({
      status: 303,
      location: "/login?to=%2Fapp%2Fsettings%3Fverification%3Dsuccess",
    });
  }
  await expect(run({ isAnonymous: false })).resolves.toEqual({});
});
