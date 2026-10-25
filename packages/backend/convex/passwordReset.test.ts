import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import betterAuthTest from "@convex-dev/better-auth/test";
import resendTest from "@convex-dev/resend/test";
import { Resend } from "@convex-dev/resend";
import { components, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("password recovery queues once, hides unknown users, consumes tokens, and replaces credentials", async () => {
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("BETTER_AUTH_SECRET", "a-test-secret-with-more-than-thirty-two-characters");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_FROM_EMAIL", "Partyroom <accounts@example.com>");
  vi.stubEnv("RESEND_TEST_MODE", "false");
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  resendTest.register(t);
  const { createAuth } = await import("./auth");
  const auth = createAuth({ runQuery: t.query, runMutation: t.mutation } as never);
  const enqueue = vi.spyOn(Resend.prototype, "sendEmail");
  const signedUp = await auth.api.signUpEmail({
    body: { email: "owner@example.com", name: "Owner", password: "old-password-123" },
  });
  enqueue.mockClear();
  const body = { email: "owner@example.com", redirectTo: "/reset-password" };
  const known = await auth.api.requestPasswordReset({ body });
  expect(enqueue).toHaveBeenCalledTimes(1);
  const emailId = await enqueue.mock.results[0].value;
  const email = await t.query(components.resend.lib.get, { emailId });
  expect(email?.subject).toBe("Reset your Partyroom password");
  const token = email!.text!.match(/reset-password\/([^?\s]+)/)![1];
  enqueue.mockClear();
  expect(
    await auth.api.requestPasswordReset({ body: { ...body, email: "unknown@example.com" } }),
  ).toEqual(known);
  expect(enqueue).not.toHaveBeenCalled();
  await expect(
    auth.api.resetPassword({ body: { token: "invalid", newPassword: "new-password-123" } }),
  ).rejects.toThrow();
  const context = await auth.$context;
  // Better Auth disables origin checks by default in test environments.
  context.skipOriginCheck = false;
  await context.internalAdapter.createVerificationValue({
    identifier: "reset-password:expired",
    value: "nobody",
    expiresAt: new Date(Date.now() - 1000),
  });
  await expect(
    auth.api.resetPassword({ body: { token: "expired", newPassword: "new-password-123" } }),
  ).rejects.toThrow();
  await expect(auth.api.resetPassword({ body: { token, newPassword: "short" } })).rejects.toThrow();
  expect(
    await auth.api.resetPassword({ body: { token, newPassword: "new-password-123" } }),
  ).toMatchObject({ status: true });
  expect(await context.internalAdapter.findSession(signedUp.token!)).toBeNull();
  await expect(
    auth.api.resetPassword({ body: { token, newPassword: "another-password" } }),
  ).rejects.toThrow();
  await expect(
    auth.api.signInEmail({ body: { email: body.email, password: "old-password-123" } }),
  ).rejects.toThrow();
  expect(
    await auth.api.signInEmail({ body: { email: body.email, password: "new-password-123" } }),
  ).toHaveProperty("user.email", body.email);
  const unsafe = await auth.handler(
    new Request("http://localhost:3000/api/auth/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ ...body, redirectTo: "https://evil.invalid" }),
    }),
  );
  expect(unsafe.status).toBe(403);
  vi.stubEnv("RESEND_API_KEY", undefined);
  await expect(
    t.mutation(internal.email.sendPasswordReset, {
      email: body.email,
      url: "http://localhost:3000/reset",
    }),
  ).rejects.toThrow("sender is not configured");
});
