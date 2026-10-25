import { convexTest } from "convex-test";
import Stripe from "stripe";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components, api, internal } from "./_generated/api";
import { authComponent } from "./auth";
import {
  getBillingCustomer,
  getPremiumAccess,
  subscriptionAccessUntil,
  RENEWAL_GRACE_MS,
} from "./billingAccess";
import { handleBillingEvent } from "./billingStripe";
import { requireRoomAction } from "./rooms";
import { defaultRoomMemberPermissions } from "./rooms.schema";
import schema from "./schema";
import { modules, registerStripe } from "./test.setup";

const now = 1_800_000_000_000;
const host = { _id: "host", email: "host@example.com", emailVerified: true };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("STRIPE_PREMIUM_PRICE_ID", "price_premium");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function billingTest() {
  const t = convexTest(schema, modules);
  registerStripe(t);
  return t;
}

async function seed(t: ReturnType<typeof billingTest>, status = "active", linked = true) {
  await t.mutation(components.stripe.public.createOrUpdateCustomer, {
    stripeCustomerId: "cus_host",
    email: host.email,
    metadata: linked ? { userId: host._id } : { partyroomEarlyAccess: "v1" },
  });
  await t.mutation(components.stripe.private.handleSubscriptionUpdated, {
    stripeSubscriptionId: "sub_host",
    stripeCustomerId: "cus_host",
    status,
    currentPeriodEnd: (now + 30 * 86_400_000) / 1000,
    cancelAtPeriodEnd: false,
    priceId: "price_premium",
    metadata: linked ? { userId: host._id } : { partyroomEarlyAccess: "v1" },
  });
}

test("only the configured active Premium price grants paid-period access", () => {
  const subscription = {
    status: "active",
    priceId: "price_premium",
    currentPeriodEnd: (now + 1000) / 1000,
  };
  expect(subscriptionAccessUntil(subscription, "price_premium", null)).toBe(now + 1000);
  expect(subscriptionAccessUntil(subscription, "another_price", null)).toBe(0);
  for (const status of ["canceled", "incomplete", "incomplete_expired", "paused", "trialing"]) {
    expect(subscriptionAccessUntil({ ...subscription, status }, "price_premium", null)).toBe(0);
  }
  expect(
    subscriptionAccessUntil({ ...subscription, cancelAt: now / 1000 }, "price_premium", null),
  ).toBe(now);
});

test("imported subscriptions require verified email and cannot be claimed by a different account", async () => {
  const t = billingTest();
  await seed(t, "active", false);
  const user = vi.spyOn(authComponent, "getAuthUser");
  user.mockResolvedValue({ ...host, emailVerified: false } as never);
  expect(await t.query(api.billing.status, {})).toMatchObject({ premium: false });
  await expect(t.mutation(internal.billing.claimCustomer, {})).rejects.toThrow("Verify your email");
  user.mockResolvedValue(host as never);
  expect(await t.query(api.billing.status, {})).toMatchObject({ premium: true });
  expect(await t.mutation(internal.billing.claimCustomer, {})).toBe("cus_host");
  expect(await t.run((ctx) => getBillingCustomer(ctx, { ...host, _id: "another" }))).toBeNull();
  expect(await t.run((ctx) => getPremiumAccess(ctx, { ...host, isAnonymous: true }))).toMatchObject(
    { premium: false },
  );
});

test("guests use their host's subscription; immediate cancellation revokes room operations", async () => {
  const t = billingTest();
  await seed(t);
  vi.spyOn(authComponent, "getAuthUser").mockResolvedValue({
    _id: "guest",
    isAnonymous: true,
  } as never);
  vi.spyOn(authComponent, "getAnyUserById").mockResolvedValue(host as never);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", {
      owner: host._id,
      name: "paid-room",
      memberPermissions: defaultRoomMemberPermissions,
    }),
  );
  expect((await t.run((ctx) => requireRoomAction(ctx, roomId, "room:read"))).user._id).toBe(
    "guest",
  );
  await seed(t, "canceled");
  await expect(t.run((ctx) => requireRoomAction(ctx, roomId, "room:read"))).rejects.toThrow(
    "Premium subscription required",
  );
});

test("unpaid accounts cannot create rooms or check out as guests", async () => {
  const t = billingTest();
  const user = vi.spyOn(authComponent, "getAuthUser").mockResolvedValue(host as never);
  await expect(t.mutation(api.rooms.createRoom, {})).rejects.toThrow(
    "Premium subscription required",
  );
  user.mockResolvedValue({ ...host, isAnonymous: true } as never);
  await expect(t.action(api.billing.checkout, {})).rejects.toThrow("Registered account required");
});

test("renewal retries and out-of-order failures cannot extend grace or undo payment", async () => {
  const t = billingTest();
  await seed(t, "past_due");
  const renewal = {
    stripeInvoiceId: "in_renewal",
    stripeSubscriptionId: "sub_host",
    invoiceCreated: now,
    eventTime: now,
    paid: false,
  };
  await t.mutation(internal.billing.recordRenewal, renewal);
  await t.mutation(internal.billing.recordRenewal, { ...renewal, eventTime: now + 86_400_000 });
  vi.spyOn(authComponent, "getAuthUser").mockResolvedValue(host as never);
  expect(await t.query(api.billing.status, {})).toMatchObject({
    premium: true,
    accessUntil: now + RENEWAL_GRACE_MS,
  });
  vi.setSystemTime(now + RENEWAL_GRACE_MS);
  // Queries change with stored expiry state; writes still reject access at the exact deadline.
  expect(await t.query(api.billing.status, {})).toMatchObject({ premium: true });
  await expect(t.mutation(api.rooms.createRoom, {})).rejects.toThrow(
    "Premium subscription required",
  );
  await t.mutation(internal.billing.expireRenewal, { stripeInvoiceId: "in_renewal" });
  expect(await t.query(api.billing.status, {})).toMatchObject({ premium: false });
  await t.mutation(internal.billing.recordRenewal, { ...renewal, paid: true });
  await t.mutation(internal.billing.recordRenewal, renewal);
  const row = await t.run((ctx) =>
    ctx.db
      .query("billingRenewals")
      .withIndex("by_invoice", (q) => q.eq("stripeInvoiceId", "in_renewal"))
      .unique(),
  );
  expect(row).toMatchObject({ paid: true, firstFailureAt: now });
});

test("scheduled cancellation retains access only through the paid period", async () => {
  const t = billingTest();
  await seed(t);
  await t.mutation(components.stripe.private.handleSubscriptionUpdated, {
    stripeSubscriptionId: "sub_host",
    status: "active",
    currentPeriodEnd: (now + 1000) / 1000,
    cancelAtPeriodEnd: true,
    cancelAt: (now + 1000) / 1000,
  });
  const period = { stripeSubscriptionId: "sub_host", expiresAt: now + 1000 };
  await t.mutation(internal.billing.recordPeriod, period);
  vi.spyOn(authComponent, "getAuthUser").mockResolvedValue(host as never);
  expect(await t.query(api.billing.status, {})).toMatchObject({
    premium: true,
    accessUntil: now + 1000,
  });
  vi.setSystemTime(now + 1000);
  await t.mutation(internal.billing.expirePeriod, period);
  expect(await t.query(api.billing.status, {})).toMatchObject({ premium: false });
});

test("early cancellation expiry is reactive and delayed timers cannot permit writes", async () => {
  const t = billingTest();
  await seed(t);
  await t.mutation(components.stripe.private.handleSubscriptionUpdated, {
    stripeSubscriptionId: "sub_host",
    status: "active",
    currentPeriodEnd: (now + 30 * 86_400_000) / 1000,
    cancelAtPeriodEnd: false,
    cancelAt: (now + 1000) / 1000,
  });
  const period = { stripeSubscriptionId: "sub_host", expiresAt: now + 1000 };
  await t.mutation(internal.billing.recordPeriod, period);
  vi.spyOn(authComponent, "getAuthUser").mockResolvedValue(host as never);
  vi.setSystemTime(now + 1000);
  expect(await t.query(api.billing.status, {})).toMatchObject({
    premium: true,
    accessUntil: now + 1000,
  });
  await expect(t.mutation(api.rooms.createRoom, {})).rejects.toThrow(
    "Premium subscription required",
  );
  await t.mutation(internal.billing.expirePeriod, period);
  expect(await t.query(api.billing.status, {})).toMatchObject({ premium: false, accessUntil: 0 });
});

test("current-user returns validate registered, guest, absent and dashboard identities", async () => {
  const t = billingTest();
  const auth = vi.spyOn(authComponent, "getAuthUser");
  auth.mockResolvedValue({
    ...host,
    name: "Host",
    image: null,
    _creationTime: now,
    createdAt: now,
  } as never);
  expect(await t.query(api.auth.getCurrentUser, {})).toEqual({
    _id: host._id,
    name: "Host",
    email: host.email,
    image: null,
    emailVerified: true,
    isAnonymous: false,
    capabilities: ["room:list"],
  });
  await seed(t);
  expect((await t.query(api.auth.getCurrentUser, {}))?.capabilities).toEqual([
    "room:list",
    "room:create",
  ]);
  auth.mockResolvedValue({ _id: "guest", name: "Guest", isAnonymous: true } as never);
  expect(await t.query(api.auth.getCurrentUser, {})).toEqual({
    _id: "guest",
    name: "Guest",
    email: null,
    image: null,
    emailVerified: false,
    isAnonymous: true,
    capabilities: [],
  });
  auth.mockResolvedValue(null as never);
  expect(await t.query(api.auth.getCurrentUser, {})).toBeNull();
  auth.mockRejectedValue(new Error("ArgumentValidationError"));
  expect(
    await t
      .withIdentity({ subject: "dashboard", name: "Dashboard user" })
      .query(api.auth.getCurrentUser, {}),
  ).toEqual({
    _id: "dashboard",
    name: "Dashboard user",
    email: null,
    image: null,
    emailVerified: false,
    isAnonymous: false,
    capabilities: ["room:list"],
  });
});

test("webhook endpoint rejects missing or invalid Stripe signatures", async () => {
  const t = billingTest();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_not_a_real_key");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  expect((await t.fetch("/stripe/webhook", { method: "POST", body: "{}" })).status).toBe(400);
  expect(
    (
      await t.fetch("/stripe/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "invalid" },
      })
    ).status,
  ).toBe(400);
});

function stripeResponses(respond: (url: URL, method: string) => unknown) {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_not_a_real_key");
  const fetchMock = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    return new Response(JSON.stringify(respond(url, options?.method ?? "GET")), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test("rerunning the import skips a revoked free subscription and rejects a live price in sandbox", async () => {
  const t = billingTest();
  let livemode = false;
  let existingStatus = "canceled";
  let complimentary = true;
  const calls = stripeResponses((url, method) => {
    if (url.pathname === "/v1/prices/price_premium")
      return {
        id: "price_premium",
        active: true,
        type: "recurring",
        product: "prod_premium",
        livemode,
      };
    if (url.pathname.includes("/coupons/")) {
      expect(url.searchParams.get("expand[0]")).toBe("applies_to");
      return {
        id: "coupon",
        percent_off: 100,
        duration: "forever",
        valid: true,
        applies_to: { products: ["prod_premium"] },
      };
    }
    if (url.pathname === "/v1/customers")
      return {
        data: [{ id: "cus_import", email: host.email, metadata: { partyroomEarlyAccess: "v1" } }],
        has_more: false,
      };
    if (url.pathname === "/v1/subscriptions") {
      if (method === "POST")
        return {
          id: "sub_new_import",
          customer: "cus_import",
          status: "active",
          cancel_at_period_end: false,
          metadata: { partyroomEarlyAccess: "v1" },
          items: {
            data: [{ current_period_end: now / 1000 + 86400, price: { id: "price_premium" } }],
          },
        };
      expect(method).toBe("GET");
      return {
        data: [
          {
            id: "sub_import",
            customer: "cus_import",
            status: existingStatus,
            cancel_at_period_end: false,
            metadata: complimentary ? { partyroomEarlyAccess: "v1" } : {},
            items: {
              data: [{ current_period_end: now / 1000 + 86400, price: { id: "price_premium" } }],
            },
          },
        ],
        has_more: false,
      };
    }
    if (url.pathname === "/v1/customers/cus_import") return { id: "cus_import" };
    throw new Error(`Unexpected Stripe request: ${method} ${url.pathname}`);
  });
  const args = { recipients: [{ email: host.email }], expectedLivemode: false };
  expect(await t.action(internal.billingStripe.importEarlyAccess, args)).toEqual({
    created: 0,
    skipped: 1,
  });
  expect(await t.run((ctx) => getPremiumAccess(ctx, host))).toMatchObject({ premium: false });
  livemode = true;
  calls.mockClear();
  await expect(t.action(internal.billingStripe.importEarlyAccess, args)).rejects.toThrow(
    "environment does not match",
  );
  expect(calls).toHaveBeenCalledTimes(1);
  livemode = false;
  complimentary = false;
  for (const status of ["active", "past_due", "unpaid", "incomplete"]) {
    existingStatus = status;
    calls.mockClear();
    await expect(t.action(internal.billingStripe.importEarlyAccess, args)).rejects.toThrow(
      "already has a Premium subscription",
    );
    expect(calls.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  }
  for (const status of ["canceled", "incomplete_expired"]) {
    existingStatus = status;
    expect(await t.action(internal.billingStripe.importEarlyAccess, args)).toEqual({
      created: 1,
      skipped: 0,
    });
  }
});

test("checkout reuses an open session and refuses subscription duplication", async () => {
  const t = billingTest();
  await seed(t, "canceled");
  vi.spyOn(authComponent, "getAuthUser").mockResolvedValue(host as never);
  let existing = false;
  stripeResponses((url, method) => {
    expect(method).toBe("GET");
    if (url.pathname === "/v1/subscriptions")
      return {
        data: existing
          ? [{ status: "past_due", items: { data: [{ price: { id: "price_premium" } }] } }]
          : [],
        has_more: false,
      };
    if (url.pathname === "/v1/checkout/sessions")
      return {
        data: [
          {
            id: "cs_existing",
            status: "open",
            url: "https://checkout.stripe.com/test",
            metadata: { partyroomPremium: "v1" },
          },
        ],
      };
    throw new Error(`Unexpected Stripe request: ${url.pathname}`);
  });
  expect(await t.action(api.billing.checkout, {})).toEqual({
    sessionId: "cs_existing",
    url: "https://checkout.stripe.com/test",
  });
  existing = true;
  await expect(t.action(api.billing.checkout, {})).rejects.toThrow("existing Premium subscription");
});

test("checkout observes completed sessions before checking for their new subscription", async () => {
  const t = billingTest();
  await seed(t, "canceled");
  vi.spyOn(authComponent, "getAuthUser").mockResolvedValue(host as never);
  let completed = false;
  const calls = stripeResponses((url, method) => {
    if (url.pathname === "/v1/checkout/sessions" && method === "GET") {
      completed = true;
      return {
        data: [{ id: "cs_completed", status: "complete", metadata: { partyroomPremium: "v1" } }],
      };
    }
    if (url.pathname === "/v1/subscriptions")
      return {
        data: completed
          ? [{ status: "active", items: { data: [{ price: { id: "price_premium" } }] } }]
          : [],
        has_more: false,
      };
    return { id: "cs_duplicate", url: "https://checkout.stripe.com/duplicate" };
  });
  await expect(t.action(api.billing.checkout, {})).rejects.toThrow("existing Premium subscription");
  expect(calls.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
});

test.each([null, "cs_expired"])(
  "concurrent Checkout requests share the idempotency key after %s",
  async (previousId) => {
    const t = billingTest();
    await seed(t, "canceled");
    vi.spyOn(authComponent, "getAuthUser").mockResolvedValue(host as never);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    vi.stubEnv("SITE_URL", "https://partyroom.invalid");
    const keys: string[] = [];
    vi.stubGlobal("fetch", async (input: string, options: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === "/v1/subscriptions") return Response.json({ data: [], has_more: false });
      if (options.method === "GET")
        return Response.json({
          data: previousId
            ? [{ id: previousId, status: "expired", metadata: { partyroomPremium: "v1" } }]
            : [],
        });
      keys.push(new Headers(options.headers).get("idempotency-key")!);
      return Response.json({ id: "cs_one", url: "https://checkout.stripe.com/one" });
    });
    const results = await Promise.all([
      t.action(api.billing.checkout, {}),
      t.action(api.billing.checkout, {}),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys)).toEqual(
      new Set([`partyroom-checkout-cus_host-${previousId ?? "first"}`]),
    );
  },
);

test("old expiry timers cannot revoke a renewed paid period", async () => {
  const t = billingTest();
  const args = { stripeSubscriptionId: "sub_host", expiresAt: now + 1000 };
  await t.mutation(internal.billing.recordPeriod, args);
  await t.mutation(internal.billing.recordPeriod, { ...args, expiresAt: now + 2000 });
  vi.setSystemTime(now + 1000);
  await t.mutation(internal.billing.expirePeriod, args);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("billingPeriods")
        .withIndex("by_subscription", (q) => q.eq("stripeSubscriptionId", "sub_host"))
        .unique(),
    ),
  ).toMatchObject({ expired: false });
});

test("a signed old webhook cannot leave a canceled subscription active", async () => {
  const t = billingTest();
  await seed(t);
  const subscription = {
    id: "sub_host",
    customer: "cus_host",
    status: "canceled",
    cancel_at_period_end: false,
    metadata: { userId: host._id },
    items: { data: [{ current_period_end: now / 1000 + 86400, price: { id: "price_premium" } }] },
  };
  stripeResponses((url) => {
    expect(url.pathname).toBe("/v1/subscriptions/sub_host");
    return subscription;
  });
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  const payload = JSON.stringify({
    id: "evt_old",
    type: "customer.subscription.updated",
    created: now / 1000 - 60,
    data: { object: { ...subscription, status: "active" } },
  });
  const signature = await new Stripe("sk_test_dummy").webhooks.generateTestHeaderStringAsync({
    payload,
    secret: "whsec_test",
    timestamp: now / 1000,
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
  });
  const response = await t.fetch("/stripe/webhook", {
    method: "POST",
    body: payload,
    headers: { "stripe-signature": signature },
  });
  expect(response.status).toBe(200);
  expect(await t.run((ctx) => getPremiumAccess(ctx, host))).toMatchObject({ premium: false });
});

async function signedEvent(t: ReturnType<typeof billingTest>, type: string, object: unknown) {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  const payload = JSON.stringify({
    id: "evt_replayed",
    type,
    created: now / 1000 - 60,
    data: { object },
  });
  const signature = await new Stripe("sk_test_dummy").webhooks.generateTestHeaderStringAsync({
    payload,
    secret: "whsec_test",
    timestamp: now / 1000,
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
  });
  return t.fetch("/stripe/webhook", {
    method: "POST",
    body: payload,
    headers: { "stripe-signature": signature },
  });
}

test("replayed customer updates use current ownership and preserve a verified local claim", async () => {
  const t = billingTest();
  await seed(t);
  stripeResponses((url) => {
    expect(url.pathname).toBe("/v1/customers/cus_host");
    return { id: "cus_host", email: host.email, metadata: { userId: host._id } };
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(
      (
        await signedEvent(t, "customer.updated", {
          id: "cus_host",
          email: host.email,
          metadata: {},
        })
      ).status,
    ).toBe(200);
    expect(await t.run((ctx) => getPremiumAccess(ctx, host))).toMatchObject({ premium: true });
  }
  // A local claim can precede the retryable Stripe metadata update.
  await t.mutation(components.stripe.private.handleCustomerUpdated, {
    stripeCustomerId: "cus_host",
    email: host.email,
    metadata: {},
  });
  expect(await t.run((ctx) => getPremiumAccess(ctx, host))).toMatchObject({ premium: true });
  expect(await t.run((ctx) => getBillingCustomer(ctx, { ...host, _id: "other" }))).toBeNull();
});

test.each(["active", "canceled"])(
  "failed refresh preserves %s access without committing an old event",
  async (status) => {
    const t = billingTest();
    await seed(t, status);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: { message: "Forbidden" } }, { status: 403 }),
    );
    const response = await signedEvent(t, "customer.subscription.updated", {
      id: "sub_host",
      customer: "cus_host",
      status: status === "active" ? "canceled" : "active",
      cancel_at_period_end: false,
      metadata: {},
      items: { data: [{ current_period_end: now / 1000 + 86400, price: { id: "price_premium" } }] },
    });
    expect(response.status).toBe(500);
    expect(await t.run((ctx) => getPremiumAccess(ctx, host))).toMatchObject({
      premium: status === "active",
    });
  },
);

test("an initial failed invoice cannot start a renewal grace period", async () => {
  const t = billingTest();
  await seed(t, "incomplete");
  stripeResponses(() => ({
    id: "sub_host",
    customer: "cus_host",
    status: "incomplete",
    cancel_at_period_end: false,
    metadata: { userId: host._id },
    items: { data: [{ current_period_end: now / 1000 + 86400, price: { id: "price_premium" } }] },
  }));
  await t.run((ctx) =>
    handleBillingEvent(ctx, {
      type: "invoice.payment_failed",
      created: now / 1000,
      data: {
        object: {
          id: "in_initial",
          created: now / 1000,
          amount_due: 499,
          billing_reason: "subscription_create",
          parent: { subscription_details: { subscription: "sub_host" } },
        },
      },
    }),
  );
  expect(await t.run((ctx) => ctx.db.query("billingRenewals").take(1))).toEqual([]);
  expect(await t.run((ctx) => getPremiumAccess(ctx, host))).toMatchObject({ premium: false });
});

test("media requests reject unauthenticated callers and unpaid hosts", async () => {
  const t = billingTest();
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", {
      owner: host._id,
      name: "unpaid-room",
      memberPermissions: defaultRoomMemberPermissions,
    }),
  );
  const user = vi.spyOn(authComponent, "getAuthUser");
  user.mockRejectedValue(new Error("Unauthenticated"));
  await expect(
    t.action(api.media.actions.requestMedia, { roomId, url: "https://example.com/song" }),
  ).rejects.toThrow("Unauthenticated");
  user.mockResolvedValue(host as never);
  await expect(
    t.action(api.media.actions.requestMedia, { roomId, url: "https://example.com/song" }),
  ).rejects.toThrow("Premium subscription required");
  expect(await t.run((ctx) => ctx.db.query("mediaJobs").take(1))).toEqual([]);
});

test("media creation rechecks host access after the action's earlier authorization", async () => {
  const t = billingTest();
  await seed(t);
  vi.spyOn(authComponent, "getAuthUser").mockResolvedValue(host as never);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", {
      owner: host._id,
      name: "revoked-room",
      memberPermissions: defaultRoomMemberPermissions,
    }),
  );
  expect(await t.query(internal.media.jobs.authorizeRequest, { roomId })).toBe(host._id);
  await seed(t, "canceled");
  await expect(
    t.mutation(internal.media.jobs.request, {
      roomId,
      requestedBy: host._id,
      requestKey: "request",
      encryptedSource: "ciphertext",
      sourceIv: "iv",
    }),
  ).rejects.toThrow("Premium subscription required");
  expect(await t.run((ctx) => ctx.db.query("mediaJobs").take(1))).toEqual([]);
});

test("billing UI exposes only owned or verified accounts, and keeps canceled history manageable", async () => {
  const t = billingTest();
  const user = vi.spyOn(authComponent, "getAuthUser").mockResolvedValue(host as never);
  expect(await t.query(api.billing.status, {})).toMatchObject({
    premium: false,
    hasBillingAccount: false,
    needsClaim: false,
    subscription: null,
  });
  await seed(t, "active", false);
  user.mockResolvedValue({ ...host, emailVerified: false } as never);
  expect(await t.query(api.billing.status, {})).toMatchObject({
    premium: false,
    hasBillingAccount: false,
    needsClaim: false,
    subscription: null,
  });
  user.mockResolvedValue(host as never);
  expect(await t.query(api.billing.status, {})).toMatchObject({
    premium: true,
    hasBillingAccount: true,
    needsClaim: true,
    subscription: { status: "active", cancelAtPeriodEnd: false, complimentary: true },
  });
  await t.mutation(internal.billing.claimCustomer, {});
  expect(await t.query(api.billing.status, {})).toMatchObject({ needsClaim: false });
  await seed(t, "canceled");
  expect(await t.query(api.billing.status, {})).toMatchObject({
    premium: false,
    hasBillingAccount: true,
    needsClaim: false,
    subscription: null,
  });
  user.mockResolvedValue({ ...host, isAnonymous: true } as never);
  expect(await t.query(api.billing.status, {})).toMatchObject({
    hasBillingAccount: false,
    subscription: null,
  });
});

test("unverified accounts cannot start Checkout or make any Stripe requests", async () => {
  const t = billingTest();
  const user = vi.spyOn(authComponent, "getAuthUser");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  for (const emailVerified of [false, undefined]) {
    user.mockResolvedValue({ ...host, emailVerified } as never);
    await expect(t.action(api.billing.checkout, {})).rejects.toThrow("Verify your email");
    expect(fetch).not.toHaveBeenCalled();
    expect(
      await t.query(components.stripe.public.getCustomerByUserId, { userId: host._id }),
    ).toBeNull();
  }
  await seed(t, "canceled");
  user.mockResolvedValue({ ...host, emailVerified: false } as never);
  await expect(t.action(api.billing.checkout, {})).rejects.toThrow("Verify your email");
  expect(fetch).not.toHaveBeenCalled();
});
