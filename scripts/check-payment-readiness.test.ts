import { expect, test } from "bun:test";
import Stripe from "stripe";
import { billingEvents, checkPaymentReadiness } from "./check-payment-readiness";

const settings = {
  STRIPE_SECRET_KEY: "rk_test_redacted",
  STRIPE_WEBHOOK_SECRET: "whsec_redacted",
  STRIPE_PREMIUM_PRICE_ID: "price_test",
  RESEND_API_KEY: "re_redacted",
  RESEND_FROM_EMAIL: "Partyroom <accounts@example.com>",
  RESEND_WEBHOOK_SECRET: "whsec_email_redacted",
  RESEND_TEST_MODE: "false",
  PUBLIC_CONVEX_SITE_URL: "https://convex.example.com",
};
function respond(wrong = false): typeof fetch {
  return (async (input: string | URL | Request, options: RequestInit) => {
    expect(options.method ?? "GET").toBe("GET");
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.pathname.startsWith("/v1/prices/"))
      return Response.json({
        active: true,
        livemode: false,
        currency: "usd",
        unit_amount: wrong ? 999 : 499,
        recurring: { interval: "month", interval_count: 1 },
      });
    if (url.pathname.includes("configurations"))
      return Response.json({
        data: [
          {
            livemode: false,
            features: {
              payment_method_update: { enabled: true },
              invoice_history: { enabled: true },
              subscription_cancel: { enabled: true, mode: "at_period_end" },
              subscription_update: { enabled: wrong },
            },
          },
        ],
      });
    if (url.pathname.includes("webhook_endpoints"))
      return Response.json({
        data: [
          {
            url: "https://convex.example.com/stripe/webhook",
            status: "enabled",
            livemode: false,
            enabled_events: wrong ? [] : billingEvents,
            api_version: Stripe.API_VERSION,
          },
        ],
      });
    if (url.hostname === "api.resend.com")
      return Response.json({ data: [{ name: "example.com", status: "verified" }] });
    throw new Error("Unexpected request");
  }) as typeof fetch;
}

test("valid configuration is read-only and never claims that delivery has been verified", async () => {
  const checks = await checkPaymentReadiness(settings, "sandbox", respond());
  expect(checks.filter((check) => check.status === "FAILED")).toEqual([]);
  expect(checks.find((check) => check.name === "Premium price")?.status).toBe("VERIFIED");
  expect(checks.find((check) => check.name === "Signed webhook delivery")?.status).toBe(
    "UNVERIFIED",
  );
  for (const secret of [
    settings.STRIPE_SECRET_KEY,
    settings.STRIPE_WEBHOOK_SECRET,
    settings.RESEND_API_KEY,
    settings.RESEND_WEBHOOK_SECRET,
  ])
    expect(JSON.stringify(checks)).not.toContain(secret);
});

test("missing settings, wrong mode, wrong price, unsafe portal and missing events fail readiness", async () => {
  expect(
    (await checkPaymentReadiness({}, "live", respond())).filter(
      (check) => check.status === "FAILED",
    ).length,
  ).toBeGreaterThan(5);
  expect(
    (await checkPaymentReadiness(settings, "live", respond())).find(
      (check) => check.name === "Stripe key mode",
    )?.status,
  ).toBe("FAILED");
  const checks = await checkPaymentReadiness(settings, "sandbox", respond(true));
  for (const name of ["Premium price", "Customer portal", "Stripe webhook destination"])
    expect(checks.find((check) => check.name === name)?.status).toBe("FAILED");
});

test("upstream failures are redacted; restricted email keys leave domain checks unverified", async () => {
  const failed = await checkPaymentReadiness(settings, "sandbox", (async () => {
    throw new Error("sensitive-upstream-detail");
  }) as unknown as typeof fetch);
  expect(failed.some((check) => check.status === "FAILED")).toBe(true);
  expect(JSON.stringify(failed)).not.toContain("sensitive-upstream-detail");
  const fetcher = respond();
  const checks = await checkPaymentReadiness(settings, "sandbox", (async (input, options) =>
    String(input).includes("api.resend.com")
      ? new Response("", { status: 403 })
      : fetcher(input, options)) as typeof fetch);
  expect(checks.find((check) => check.name === "Email sender domain")?.status).toBe("UNVERIFIED");
});
