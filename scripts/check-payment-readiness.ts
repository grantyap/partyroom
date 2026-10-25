import Stripe from "stripe";

export const billingEvents = [
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "checkout.session.completed",
  "invoice.created",
  "invoice.finalized",
  "invoice.updated",
  "invoice.paid",
  "invoice.payment_failed",
];

type Check = {
  name: string;
  status: "CONFIGURED" | "VERIFIED" | "FAILED" | "UNVERIFIED";
  detail: string;
};

/** Read-only: configuration checks cannot prove delivery or mutate Dashboard settings. */
export async function checkPaymentReadiness(
  settings: Record<string, string | undefined>,
  mode: "live" | "sandbox",
  fetcher: typeof fetch = fetch,
) {
  const checks: Check[] = [];
  const add = (name: string, status: Check["status"], detail: string) =>
    checks.push({ name, status, detail });
  const required = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PREMIUM_PRICE_ID",
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "RESEND_WEBHOOK_SECRET",
  ];
  for (const name of required)
    add(
      name,
      settings[name] ? "CONFIGURED" : "FAILED",
      settings[name] ? "Present; value redacted." : "Set this in the target backend environment.",
    );
  let origin: URL | undefined;
  try {
    origin = new URL(settings.PUBLIC_CONVEX_SITE_URL ?? settings.CONVEX_SITE_ORIGIN ?? "");
    if (
      origin.protocol !== "https:" ||
      origin.pathname !== "/" ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash
    )
      throw new Error();
    add(
      "Webhook origin",
      "CONFIGURED",
      "HTTPS origin present; delivery still requires verification.",
    );
  } catch {
    add(
      "Webhook origin",
      "FAILED",
      "Set PUBLIC_CONVEX_SITE_URL to the public HTTPS Convex HTTP origin.",
    );
    origin = undefined;
  }
  if (settings.RESEND_TEST_MODE !== "false")
    add(
      "Email sending mode",
      "FAILED",
      "Set RESEND_TEST_MODE=false to deliver verification/reset links to real test inboxes.",
    );
  else add("Email sending mode", "CONFIGURED", "Real-recipient mode enabled; delivery unverified.");
  const live = mode === "live";
  const matchingKey = new RegExp(`^(sk|rk)_${live ? "live" : "test"}_`).test(
    settings.STRIPE_SECRET_KEY ?? "",
  );
  add(
    "Stripe key mode",
    matchingKey ? "CONFIGURED" : "FAILED",
    matchingKey ? `Matches requested ${mode} mode.` : `Supply a key for requested ${mode} mode.`,
  );
  if (matchingKey && settings.STRIPE_PREMIUM_PRICE_ID) {
    const stripe = new Stripe(settings.STRIPE_SECRET_KEY!, {
      httpClient: Stripe.createFetchHttpClient(fetcher),
      maxNetworkRetries: 0,
      timeout: 10_000,
    });
    try {
      const price = await stripe.prices.retrieve(settings.STRIPE_PREMIUM_PRICE_ID);
      const valid =
        price.active &&
        price.livemode === live &&
        price.currency === "usd" &&
        price.unit_amount === 499 &&
        price.recurring?.interval === "month" &&
        price.recurring.interval_count === 1;
      add(
        "Premium price",
        valid ? "VERIFIED" : "FAILED",
        valid
          ? "Active USD 4.99 monthly price matches UI and mode."
          : "Use an active USD 499-cent monthly recurring price in the requested mode.",
      );
    } catch {
      add(
        "Premium price",
        "FAILED",
        "Unable to read price; check the key permissions, price ID, and Stripe availability.",
      );
    }
    try {
      const configurations = await stripe.billingPortal.configurations.list({
        active: true,
        is_default: true,
        limit: 1,
      });
      const portal = configurations.data[0];
      const features = portal?.features;
      const valid =
        portal?.livemode === live &&
        features?.payment_method_update.enabled &&
        features.invoice_history.enabled &&
        features.subscription_cancel.enabled &&
        features.subscription_cancel.mode === "at_period_end" &&
        !features.subscription_update.enabled;
      add(
        "Customer portal",
        valid ? "VERIFIED" : "FAILED",
        valid
          ? "Default portal supports invoices, payment updates, period-end cancellation; plan/quantity changes disabled."
          : "Configure the default portal for invoices, payment updates and period-end cancellation; disable subscription updates.",
      );
    } catch {
      add(
        "Customer portal",
        "FAILED",
        "Unable to read portal; check portal-read permission and Stripe availability.",
      );
    }
    if (origin) {
      try {
        // shortcut: inspect the first 100 destinations; paginate when an account exceeds this.
        const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
        const endpoint = endpoints.data.find(
          (endpoint) =>
            endpoint.url === new URL("/stripe/webhook", origin).href &&
            endpoint.status === "enabled" &&
            endpoint.livemode === live,
        );
        const events = endpoint?.enabled_events ?? [];
        const valid =
          endpoint &&
          (events.includes("*") || billingEvents.every((event) => events.includes(event)));
        add(
          "Stripe webhook destination",
          valid ? "VERIFIED" : "FAILED",
          valid
            ? "Enabled destination matches origin, mode and required events; delivery unverified."
            : "Configure an enabled /stripe/webhook destination with all required events (first 100 endpoints checked).",
        );
        add(
          "Webhook API version",
          endpoint?.api_version === Stripe.API_VERSION ? "VERIFIED" : "UNVERIFIED",
          endpoint?.api_version === Stripe.API_VERSION
            ? "Destination version matches the installed SDK."
            : "Confirm the destination/account API version matches the installed Stripe SDK.",
        );
      } catch {
        add(
          "Stripe webhook destination",
          "FAILED",
          "Unable to inspect destinations; check webhook-read permission and Stripe availability.",
        );
      }
    }
  }
  if (settings.RESEND_API_KEY && settings.RESEND_FROM_EMAIL) {
    try {
      const address =
        settings.RESEND_FROM_EMAIL.match(/<([^>]+)>/)?.[1] ?? settings.RESEND_FROM_EMAIL;
      const domain = address.trim().split("@")[1]?.toLowerCase();
      const response = await fetcher("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${settings.RESEND_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 403 || response.status === 401)
        add(
          "Email sender domain",
          "UNVERIFIED",
          "Sending-only keys may not list domains; verify the sender domain in Resend Dashboard.",
        );
      else {
        if (!response.ok) throw new Error();
        // shortcut: inspect the first domain page; paginate when the sender moves beyond it.
        const result = (await response.json()) as { data: Array<{ name: string; status: string }> };
        const verified =
          domain &&
          result.data.some(
            (item) => item.name.toLowerCase() === domain && item.status === "verified",
          );
        add(
          "Email sender domain",
          verified ? "VERIFIED" : "FAILED",
          verified
            ? "Sender domain is verified; inbox delivery unverified."
            : "Verify the configured sender domain in Resend; inspect additional domain pages if needed.",
        );
      }
    } catch {
      add(
        "Email sender domain",
        "FAILED",
        "Unable to inspect sender domain; check Resend availability and configuration.",
      );
    }
  }
  add(
    "Signed webhook delivery",
    "UNVERIFIED",
    "Run the sandbox acceptance walkthrough; confirm Stripe and Resend signed events reach this backend. Secret presence and URL reachability do not prove delivery.",
  );
  add(
    "Renewal retries",
    "UNVERIFIED",
    "Confirm Dashboard retries preserve seven-day grace and test failure, expiry and recovery using a sandbox test clock.",
  );
  add(
    "Verification/reset delivery",
    "UNVERIFIED",
    "Verify both links in a designated inbox; disable email link/open tracking.",
  );
  return checks;
}

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode !== "live" && mode !== "sandbox") {
    console.error(
      "Usage: bun --env-file /path/to/target.env scripts/check-payment-readiness.ts live|sandbox",
    );
    process.exitCode = 1;
  } else {
    const checks = await checkPaymentReadiness(process.env, mode);
    for (const check of checks) console.log(`${check.status}: ${check.name} — ${check.detail}`);
    process.exitCode = checks.some((check) => check.status === "FAILED")
      ? 1
      : checks.some((check) => check.status === "UNVERIFIED")
        ? 2
        : 0;
  }
}
