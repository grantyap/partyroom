import assert from "node:assert/strict";

// Pass an authenticated Codex browser tab. Creates one empty room (expires automatically).
// Uses the same browser API as check-marketing-previews.mjs.
export async function checkRoomCreation(tab) {
  const startedAt = Date.now();
  const origin = new URL(await tab.url()).origin;
  const page = tab.playwright;
  await tab.goto(`${origin}/app`);
  await page.getByRole("button", { name: "Create room", exact: true }).click({ timeoutMs: 15000 });
  await page.waitForURL("**/app/rooms/*", { timeoutMs: 30000 });
  const roomUrl = new URL(await tab.url());
  assert.equal(roomUrl.origin, origin);
  assert.match(roomUrl.pathname, /^\/app\/rooms\/[^/]+$/);
  await page.getByRole("button", { name: "Room settings", exact: true }).waitFor({ state: "visible", timeoutMs: 15000 });
  await tab.reload();
  await page.getByRole("button", { name: "Room settings", exact: true }).waitFor({ state: "visible", timeoutMs: 15000 });
  await tab.goto(`${origin}/app`);
  await page.locator(`a[href="${roomUrl.pathname}"]`).waitFor({ state: "visible", timeoutMs: 15000 });
  const errors = (await tab.dev.logs({ levels: ["error"], limit: 100 }))
    .filter((entry) => Date.parse(entry.timestamp) >= startedAt);
  assert.equal(errors.length, 0, errors.map((entry) => entry.message).join("\n"));
  return { roomUrl: roomUrl.href };
}
