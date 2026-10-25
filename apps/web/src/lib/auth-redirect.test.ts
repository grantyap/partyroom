import { expect, test } from "bun:test";
import { authRedirect, verificationRedirect } from "./auth-redirect";

test("auth returns to local rooms or Premium, never an external origin or auth loop", () => {
  for (const target of [
    null,
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/login",
    "/sign-up",
    "http://[invalid",
  ]) {
    expect(authRedirect(target)).toBe("/app");
  }
  expect(authRedirect("/app/rooms/party?join=1#chat")).toBe("/app/rooms/party?join=1#chat");
  expect(authRedirect("/app?billing")).toBe("/app?billing");
});

test("verification preserves the intended room, query and hash while clearing old errors", () => {
  expect(verificationRedirect("/app/rooms/party?join=1&error=expired#chat")).toBe(
    "/app/rooms/party?join=1&verification=success#chat",
  );
  expect(verificationRedirect("/app?billing")).toBe("/app?billing=&verification=success");
  expect(verificationRedirect("https://evil.invalid")).toBe("/app?verification=success");
});
