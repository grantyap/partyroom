import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { Resend } from "@convex-dev/resend";
import resendTest from "@convex-dev/resend/test";
import { components, internal } from "./_generated/api";
import { createAuth } from "./auth";
import schema from "./schema";
import { modules } from "./test.setup";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test.each(["verification", "password reset"])(
  "Better Auth durably queues a %s link once without sending inline",
  async (kind) => {
    vi.useFakeTimers();
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("RESEND_FROM_EMAIL", "Partyroom <accounts@example.com>");
    vi.stubEnv("RESEND_TEST_MODE", "false");
    const t = convexTest(schema, modules);
    resendTest.register(t);
    const enqueue = vi.spyOn(Resend.prototype, "sendEmail");
    const auth = createAuth({ runMutation: t.mutation } as Parameters<typeof createAuth>[0]);
    expect(auth.options.emailVerification?.sendOnSignUp).toBe(true);
    const send =
      kind === "verification"
        ? auth.options.emailVerification!.sendVerificationEmail!
        : auth.options.emailAndPassword!.sendResetPassword!;
    const url =
      kind === "verification"
        ? "https://example.com/api/auth/verify-email?token=test-token&callbackURL=%2Fapp"
        : "https://example.com/api/auth/reset-password/test-token?callbackURL=%2Freset-password";
    const data = { user: { email: "owner@example.com" }, url, token: "test-token" };
    await send(data as Parameters<typeof send>[0]);
    await send(data as Parameters<typeof send>[0]);
    const first = await enqueue.mock.results[0]!.value;
    expect(await enqueue.mock.results[1]!.value).toBe(first);
    const email = await t.query(components.resend.lib.get, { emailId: first });
    expect(email).toMatchObject({
      from: "Partyroom <accounts@example.com>",
      to: ["owner@example.com"],
      status: "waiting",
      subject:
        kind === "verification" ? "Verify your Partyroom email" : "Reset your Partyroom password",
    });
    expect(email?.text).toContain(url);
  },
);

test("unconfigured sender keeps signup available and cannot silently discard verification", async () => {
  vi.stubEnv("RESEND_API_KEY", undefined);
  vi.stubEnv("RESEND_FROM_EMAIL", undefined);
  const t = convexTest(schema, modules);
  const auth = createAuth({} as Parameters<typeof createAuth>[0]);
  expect(auth.options.emailVerification?.sendOnSignUp).toBe(false);
  expect(auth.options.emailAndPassword?.requireEmailVerification).toBe(false);
  for (const send of [internal.email.sendVerification, internal.email.sendPasswordReset]) {
    await expect(
      t.mutation(send, {
        email: "owner@example.com",
        url: "https://example.com",
      }),
    ).rejects.toThrow("sender is not configured");
  }
});

test("Resend test mode blocks real recipients and webhook rejects unsigned events", async () => {
  vi.useFakeTimers();
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM_EMAIL", "Partyroom <accounts@example.com>");
  vi.stubEnv("RESEND_TEST_MODE", "true");
  vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_dGVzdC1zZWNyZXQ=");
  const t = convexTest(schema, modules);
  resendTest.register(t);
  expect(
    createAuth({} as Parameters<typeof createAuth>[0]).options.emailVerification?.sendOnSignUp,
  ).toBe(false);
  for (const send of [internal.email.sendVerification, internal.email.sendPasswordReset]) {
    await expect(
      t.mutation(send, {
        email: "owner@example.com",
        url: "https://example.com",
      }),
    ).rejects.toThrow("Test mode is enabled");
  }
  await expect(t.fetch("/resend/webhook", { method: "POST", body: "{}" })).rejects.toThrow(
    "Missing required headers",
  );
});
