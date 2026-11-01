import { expect, test } from "bun:test";
import { resetPasswordSchema } from "./components/auth/form-schema";

test("reset password validates matching passwords and Better Auth length limits", () => {
  expect(
    resetPasswordSchema.safeParse({ password: "new-password", confirmPassword: "new-password" })
      .success,
  ).toBe(true);
  for (const [password, confirmPassword] of [
    ["short", "short"],
    ["new-password", "different"],
    ["x".repeat(129), "x".repeat(129)],
  ]) {
    expect(resetPasswordSchema.safeParse({ password, confirmPassword }).success).toBe(false);
  }
});
