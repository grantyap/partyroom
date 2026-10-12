import { expect, test } from "bun:test";
import { authRedirect } from "./auth-redirect";

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
