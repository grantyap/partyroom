import { v } from "convex/values";
import { StripeSubscriptions } from "@convex-dev/stripe";
import { components, internal } from "./_generated/api";
import { action, query, internalQuery, internalMutation, env } from "./_generated/server";
import { getCurrentUserImpl } from "./auth";
import { isAnonymousUser } from "./capabilities";
import { getBillingCustomer, getPremiumAccess, RENEWAL_GRACE_MS } from "./billingAccess";
import { stripeApi } from "./billingStripe";

/** Webhook-synchronized access; accessUntil is Unix milliseconds. Checkout redirects grant nothing. */
export const status = query({
  args: {},
  returns: v.object({
    premium: v.boolean(),
    accessUntil: v.number(),
    hasBillingAccount: v.boolean(),
    needsClaim: v.boolean(),
    subscription: v.union(
      v.null(),
      v.object({
        status: v.string(),
        cancelAtPeriodEnd: v.boolean(),
        complimentary: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const user = await getCurrentUserImpl(ctx);
    const customer = user ? await getBillingCustomer(ctx, user) : null;
    const subscriptions = customer
      ? await ctx.runQuery(components.stripe.public.listSubscriptions, {
          stripeCustomerId: customer.stripeCustomerId,
        })
      : [];
    // Terminal subscriptions keep portal history available but allow a new purchase.
    const subscription = subscriptions.find(
      (s) =>
        s.priceId === env.STRIPE_PREMIUM_PRICE_ID &&
        s.status !== "canceled" &&
        s.status !== "incomplete_expired",
    );
    return {
      ...(user ? await getPremiumAccess(ctx, user) : { premium: false, accessUntil: 0 }),
      hasBillingAccount: Boolean(customer),
      needsClaim: Boolean(customer && customer.metadata?.userId !== user?._id),
      subscription: subscription
        ? {
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            complimentary: subscription.metadata?.partyroomEarlyAccess === "v1",
          }
        : null,
    };
  },
});

export const checkout = action({
  args: {},
  returns: v.object({ sessionId: v.string(), url: v.union(v.string(), v.null()) }),
  handler: async (ctx): Promise<{ sessionId: string; url: string | null }> => {
    const account = await ctx.runQuery(internal.billing.account, {});
    if (!account.emailVerified) throw new Error("Verify your email before starting Checkout");
    if (account.premium) throw new Error("Premium is already active");
    if (!env.STRIPE_PREMIUM_PRICE_ID) throw new Error("Stripe price is not configured");
    const client = new StripeSubscriptions(components.stripe);
    const customerId =
      account.customerId ??
      (
        await client.createCustomer(ctx, {
          email: account.email,
          name: account.name,
          metadata: { userId: account.userId },
          idempotencyKey: `partyroom-user-${account.userId}`,
        })
      ).customerId;
    if (account.customerId) await ctx.runMutation(internal.billing.claimCustomer, {});
    const stripe = stripeApi();
    for await (const subscription of stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    })) {
      if (
        subscription.items.data.some((item) => item.price.id === env.STRIPE_PREMIUM_PRICE_ID) &&
        subscription.status !== "canceled" &&
        subscription.status !== "incomplete_expired"
      ) {
        throw new Error("Manage your existing Premium subscription in the billing portal");
      }
    }
    const sessions = await stripe.checkout.sessions.list({ customer: customerId, limit: 100 });
    const previous = sessions.data.find((session) => session.metadata?.partyroomPremium === "v1");
    if (previous?.status === "open") return { sessionId: previous.id, url: previous.url };
    // Fixed server-side price and redirect origins. No client-supplied billing identity.
    // The previous session ID provides a stable key for concurrent checkout requests.
    const session = await stripe.checkout.sessions.create(
      {
        customer: customerId,
        line_items: [{ price: env.STRIPE_PREMIUM_PRICE_ID, quantity: 1 }],
        mode: "subscription",
        success_url: new URL("/app/settings?billing=success", env.SITE_URL).href,
        cancel_url: new URL("/app/settings?billing=canceled", env.SITE_URL).href,
        subscription_data: { metadata: { userId: account.userId } },
        metadata: { partyroomPremium: "v1", userId: account.userId },
      },
      { idempotencyKey: `partyroom-checkout-${customerId}-${previous?.id ?? "first"}` },
    );
    return { sessionId: session.id, url: session.url };
  },
});

// Configure the Stripe portal for period-end cancellation, payment-method updates and
// invoices; disable plan changes. Retry settings must preserve the seven-day renewal grace.
export const portal = action({
  args: {},
  returns: v.object({ url: v.string() }),
  handler: async (ctx): Promise<{ url: string }> => {
    const account = await ctx.runQuery(internal.billing.account, {});
    if (!account.customerId) throw new Error("No billing account found");
    await ctx.runMutation(internal.billing.claimCustomer, {});
    return await new StripeSubscriptions(components.stripe).createCustomerPortalSession(ctx, {
      customerId: account.customerId,
      returnUrl: new URL("/app/settings", env.SITE_URL).href,
    });
  },
});

export const account = internalQuery({
  args: {},
  returns: v.object({
    userId: v.string(),
    email: v.string(),
    emailVerified: v.boolean(),
    name: v.optional(v.string()),
    customerId: v.union(v.string(), v.null()),
    premium: v.boolean(),
  }),
  handler: async (ctx) => {
    const user = await getCurrentUserImpl(ctx);
    if (!user || isAnonymousUser(user)) throw new Error("Registered account required");
    if (!user.email) throw new Error("Email required");
    const customer = await getBillingCustomer(ctx, user);
    if (!customer) {
      const matching = await ctx.runQuery(components.stripe.public.getCustomerByEmail, {
        email: user.email.trim().toLowerCase(),
      });
      if (matching?.metadata?.partyroomEarlyAccess === "v1") {
        throw new Error("Verify your email before claiming your complimentary subscription");
      }
    }
    return {
      userId: user._id,
      email: user.email.trim().toLowerCase(),
      emailVerified: "emailVerified" in user && user.emailVerified === true,
      name: user.name,
      customerId: customer?.stripeCustomerId ?? null,
      premium: (await getPremiumAccess(ctx, user)).premium,
    };
  },
});

// Only verified users may claim an imported customer. The component mutation
// participates in this transaction so two accounts cannot claim the same customer.
export const claimCustomer = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const user = await getCurrentUserImpl(ctx);
    if (!user || isAnonymousUser(user)) throw new Error("Registered account required");
    const customer = await getBillingCustomer(ctx, user);
    if (customer?.userId === user._id) return customer.stripeCustomerId;
    if (!("emailVerified" in user) || !user.emailVerified)
      throw new Error("Verify your email before claiming billing access");
    if (!customer) throw new Error("No billing account found");
    await ctx.runMutation(components.stripe.public.createOrUpdateCustomer, {
      stripeCustomerId: customer.stripeCustomerId,
      metadata: { ...customer.metadata, userId: user._id },
    });
    return customer.stripeCustomerId;
  },
});

export const recordRenewal = internalMutation({
  args: {
    stripeInvoiceId: v.string(),
    stripeSubscriptionId: v.string(),
    invoiceCreated: v.number(),
    eventTime: v.number(),
    paid: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const previous = await ctx.db
      .query("billingRenewals")
      .withIndex("by_invoice", (q) => q.eq("stripeInvoiceId", args.stripeInvoiceId))
      .unique();
    // A delayed failure must not undo a successful payment or extend the grace period.
    const paid = args.paid || previous?.paid === true;
    const firstFailureAt = paid
      ? previous?.firstFailureAt
      : Math.min(previous?.firstFailureAt ?? Infinity, args.eventTime);
    const expired =
      !paid && firstFailureAt !== undefined && firstFailureAt + RENEWAL_GRACE_MS <= Date.now();
    const row = {
      stripeInvoiceId: args.stripeInvoiceId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      invoiceCreated: args.invoiceCreated,
      firstFailureAt,
      paid,
      expired,
    };
    if (previous) await ctx.db.patch("billingRenewals", previous._id, row);
    else await ctx.db.insert("billingRenewals", row);
    if (!paid && !expired && firstFailureAt !== undefined) {
      await ctx.scheduler.runAt(firstFailureAt + RENEWAL_GRACE_MS, internal.billing.expireRenewal, {
        stripeInvoiceId: args.stripeInvoiceId,
      });
    }
    return null;
  },
});

export const expireRenewal = internalMutation({
  args: { stripeInvoiceId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const renewal = await ctx.db
      .query("billingRenewals")
      .withIndex("by_invoice", (q) => q.eq("stripeInvoiceId", args.stripeInvoiceId))
      .unique();
    if (
      renewal &&
      !renewal.paid &&
      renewal.firstFailureAt !== undefined &&
      renewal.firstFailureAt + RENEWAL_GRACE_MS <= Date.now()
    ) {
      await ctx.db.patch("billingRenewals", renewal._id, { expired: true });
    }
    return null;
  },
});

// Date comparisons alone don't invalidate cached queries. These scheduled writes
// make the paid-period boundary reactive even if Stripe's next webhook is delayed.
export const recordPeriod = internalMutation({
  args: { stripeSubscriptionId: v.string(), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const previous = await ctx.db
      .query("billingPeriods")
      .withIndex("by_subscription", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
      .unique();
    const row = { ...args, expired: args.expiresAt <= Date.now() };
    if (previous) await ctx.db.patch("billingPeriods", previous._id, row);
    else await ctx.db.insert("billingPeriods", row);
    if (!row.expired && previous?.expiresAt !== args.expiresAt) {
      await ctx.scheduler.runAt(args.expiresAt, internal.billing.expirePeriod, args);
    }
    return null;
  },
});

export const expirePeriod = internalMutation({
  args: { stripeSubscriptionId: v.string(), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const period = await ctx.db
      .query("billingPeriods")
      .withIndex("by_subscription", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
      .unique();
    if (period && period.expiresAt === args.expiresAt && period.expiresAt <= Date.now()) {
      await ctx.db.patch("billingPeriods", period._id, { expired: true });
    }
    return null;
  },
});
