import { Resend } from "@convex-dev/resend";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { env, httpAction, internalMutation } from "./_generated/server";

/** Better Auth owns tokens; Resend's durable queue owns delivery retries (no extra Workflow).
 * Test mode permits only Resend test recipients, e.g. delivered@resend.dev.
 */
export const sendVerification = internalMutation({
  args: { email: v.string(), url: v.string() },
  returns: v.null(),
  handler: async (ctx, { email, url }) => {
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      throw new Error("Verification email sender is not configured");
    }
    const resend = new Resend(components.resend, {
      apiKey: env.RESEND_API_KEY,
      testMode: env.RESEND_TEST_MODE !== "false",
    });
    await resend.sendEmail(ctx, {
      from: env.RESEND_FROM_EMAIL,
      to: email,
      subject: "Verify your Partyroom email",
      text: `Verify your email address to claim your Partyroom access:\n\n${url}\n\nIf you didn't request this email, you can ignore it.`,
      idempotencyKey: `verify-email:${url}`,
    });
    return null;
  },
});

export const webhook = httpAction(async (ctx, request) => {
  if (!env.RESEND_WEBHOOK_SECRET) {
    return new Response("Resend webhook is not configured", { status: 503 });
  }
  return new Resend(components.resend, {
    webhookSecret: env.RESEND_WEBHOOK_SECRET,
  }).handleResendEventWebhook(ctx, request);
});

export const cleanup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runMutation(components.resend.lib.cleanupOldEmails, {
      olderThan: 7 * 24 * 60 * 60 * 1000,
    });
    await ctx.runMutation(components.resend.lib.cleanupAbandonedEmails, {
      olderThan: 28 * 24 * 60 * 60 * 1000,
    });
    return null;
  },
});
