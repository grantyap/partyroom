import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { chromium } from "playwright";
import { checkRoomCreation } from "./check-room-creation-unattended.mjs";

test("authenticated smoke checks creation, reload, persistence, and browser errors", async () => {
  let error = false;
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    if (req.url === "/login") res.end('<label>Email<input></label><label>Password<input type="password"></label><button onclick="location.href=\'/app\'">Login</button>');
    else if (req.url === "/app") res.end('<button onclick="localStorage.room=1; location.href=\'/app/rooms/123\'">Create room</button><script>if(localStorage.room) document.write(\'<a href="/app/rooms/123">Room</a>\')</script>');
    else res.end(`<button>Room settings</button>${error ? "<script>console.error('failure')</script>" : ""}`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    await checkRoomCreation(await browser.newPage(), origin, "test@example.com", "password");
    error = true;
    await assert.rejects(checkRoomCreation(await browser.newPage(), origin, "test@example.com", "password"), /Browser errors/);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
