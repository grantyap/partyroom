import { expect, mock, test } from "bun:test";

let currentUser: { isAnonymous: boolean; capabilities?: string[]; emailVerified?: boolean } | null =
  null;
mock.module("./auth.remote", () => ({ getCurrentUser: async () => currentUser }));
const { load: login } = await import("../routes/login/+page.server");
const { load: signup } = await import("../routes/sign-up/+page.server");

test("auth screens redirect every registered user while keeping guest access", async () => {
  for (const load of [login, signup]) {
    const run = (to: string) =>
      load({
        url: new URL(`https://partyroom.invalid/login?to=${encodeURIComponent(to)}`),
      } as Parameters<typeof login>[0] & Parameters<typeof signup>[0]);
    for (const user of [null, { isAnonymous: true }]) {
      currentUser = user;
      await expect(run("/app")).resolves.toBeUndefined();
    }
    for (const user of [
      { isAnonymous: false, capabilities: ["room:list"], emailVerified: false },
      { isAnonymous: false, capabilities: ["room:list"], emailVerified: true },
      { isAnonymous: false, capabilities: ["room:list", "room:create"], emailVerified: true },
    ]) {
      currentUser = user;
      await expect(run("/app/settings?billing=success")).rejects.toMatchObject({
        status: 303,
        location: "/app/settings?billing=success",
      });
      for (const unsafe of ["https://evil.invalid", "/login", "/sign-up"]) {
        await expect(run(unsafe)).rejects.toMatchObject({ status: 303, location: "/app" });
      }
    }
  }
});
