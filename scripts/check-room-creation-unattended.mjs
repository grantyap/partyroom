import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

export async function checkRoomCreation(page, origin, email, password) {
  await page.goto(`${origin}/login`);
  assert.equal(new URL(page.url()).origin, origin, "Login redirected to a different origin");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await page.waitForURL(`${origin}/app`, { timeout: 30000 });

  let errors = 0;
  page.on("pageerror", () => errors++);
  page.on("console", (message) => { if (message.type() === "error") errors++; });
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await page.waitForURL(`${origin}/app/rooms/*`, { timeout: 30000 });
  const roomUrl = new URL(page.url());
  assert.equal(roomUrl.origin, origin);
  assert.match(roomUrl.pathname, /^\/app\/rooms\/[^/]+$/);
  await page.getByRole("button", { name: "Room settings", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Room settings", exact: true }).waitFor();
  await page.goto(`${origin}/app`);
  await page.locator(`a[href="${roomUrl.pathname}"]`).waitFor();
  assert.equal(errors, 0, "Browser errors occurred during room creation");
}

async function main() {
  const { SMOKE_ORIGIN: origin, SMOKE_EMAIL: email, SMOKE_PASSWORD: password } = process.env;
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin || !email || !password)
    throw new Error("Set SMOKE_ORIGIN to an HTTPS origin and provide SMOKE_EMAIL and SMOKE_PASSWORD");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await checkRoomCreation(page, origin, email, password);
    console.log("PASS: authenticated room creation, reload, and room list");
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => { console.error("Authenticated room creation smoke failed"); process.exitCode = 1; });
