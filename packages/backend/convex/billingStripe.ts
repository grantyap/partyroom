import Stripe from "stripe";
import { processEvent } from "@convex-dev/stripe";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { action, httpAction, internalAction, env, type ActionCtx } from "./_generated/server";

export function stripeApi() {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe API key is not configured");
  return new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
}

async function syncSubscription(
  ctx: Pick<ActionCtx, "runMutation">,
  subscription: Stripe.Subscription,
) {
  const item = subscription.items.data[0];
  await ctx.runMutation(components.stripe.private.handleSubscriptionUpdated, {
    stripeSubscriptionId: subscription.id,
    stripeCustomerId:
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    status: subscription.status,
    currentPeriodEnd: item?.current_period_end ?? 0,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelAt: subscription.cancel_at ?? undefined,
    quantity: item?.quantity ?? 1,
    priceId: item?.price.id,
    metadata: subscription.metadata,
  });
  await ctx.runMutation(internal.billing.recordPeriod, {
    stripeSubscriptionId: subscription.id,
    expiresAt: Math.min(item?.current_period_end ?? 0, subscription.cancel_at ?? Infinity) * 1000,
  });
}

export async function handleBillingEvent(
  ctx: Pick<ActionCtx, "runMutation">,
  event: { type: string; created: number; data: { object: unknown } },
) {
  const stripe = stripeApi();
  if (["customer.created", "customer.updated", "customer.deleted"].includes(event.type)) {
    const current = await stripe.customers.retrieve((event.data.object as Stripe.Customer).id);
    if (current.deleted) {
      await ctx.runMutation(components.stripe.private.handleCustomerDeleted, {
        stripeCustomerId: current.id,
      });
    } else {
      await ctx.runMutation(components.stripe.public.createOrUpdateCustomer, {
        stripeCustomerId: current.id,
        email: current.email ?? undefined,
        name: current.name ?? undefined,
        metadata: current.metadata,
      });
    }
  }
  if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    // Retrieve current state: replaying an old update must not resurrect a canceled subscription.
    await syncSubscription(ctx, await stripe.subscriptions.retrieve(subscription.id));
  }
  if (event.type === "invoice.payment_failed" || event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const subscription = invoice.parent?.subscription_details?.subscription;
    const subscriptionId = typeof subscription === "string" ? subscription : subscription?.id;
    if (!subscriptionId) return;
    const current = await stripe.subscriptions.retrieve(subscriptionId);
    if (invoice.billing_reason === "subscription_cycle" && invoice.amount_due > 0) {
      await ctx.runMutation(internal.billing.recordRenewal, {
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId: subscriptionId,
        invoiceCreated: invoice.created * 1000,
        eventTime: event.created * 1000,
        paid: event.type === "invoice.paid",
      });
    }
    await syncSubscription(ctx, current);
  }
}

export const webhook = httpAction(async (ctx, request) => {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET)
    return new Response("Stripe webhook is not configured", { status: 503 });
  const stripe = stripeApi();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await request.text(),
      request.headers.get("stripe-signature") ?? "",
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return new Response("Invalid Stripe signature", { status: 400 });
  }
  try {
    // The component commits event snapshots before custom hooks; access needs current state first.
    if (!event.type.startsWith("customer."))
      await processEvent(ctx, components.stripe, event, stripe);
    await handleBillingEvent(ctx, event);
    return Response.json({ received: true });
  } catch {
    console.error("Stripe webhook processing failed", event.id, event.type);
    return new Response("Stripe webhook processing failed", { status: 500 });
  }
});

export const linkImportedCustomer = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const customerId = await ctx.runMutation(internal.billing.claimCustomer, {});
    const account = await ctx.runQuery(internal.billing.account, {});
    await stripeApi().customers.update(customerId, { metadata: { userId: account.userId } });
    return null;
  },
});

/** One-time import run separately for sandbox and live via scripts/import-early-access.py.
 * The private product-restricted coupon grants free access indefinitely without a promotion code.
 * Revoke by canceling the subscription immediately in Stripe; retries never restore a revoked grant.
 */
export const importEarlyAccess = internalAction({
  args: {
    recipients: v.array(v.object({ email: v.string(), name: v.optional(v.string()) })),
    expectedLivemode: v.boolean(),
  },
  returns: v.object({ created: v.number(), skipped: v.number() }),
  handler: async (ctx, { recipients, expectedLivemode }) => {
    if (recipients.length > 100) throw new Error("Import at most 100 recipients per call");
    const normalized = recipients.map((r) => ({ ...r, email: r.email.trim().toLowerCase() }));
    if (normalized.some((r) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)))
      throw new Error("Invalid import email");
    if (new Set(normalized.map((r) => r.email)).size !== normalized.length)
      throw new Error("Duplicate import emails");
    if (!env.STRIPE_PREMIUM_PRICE_ID) throw new Error("Stripe price is not configured");
    const stripe = stripeApi();
    const price = await stripe.prices.retrieve(env.STRIPE_PREMIUM_PRICE_ID);
    if (price.livemode !== expectedLivemode)
      throw new Error("Stripe environment does not match the requested import");
    if (!price.active || price.type !== "recurring")
      throw new Error("An active recurring price is required");
    const product = typeof price.product === "string" ? price.product : price.product.id;
    const couponId = "partyroom-early-access-lifetime";
    let coupon: Stripe.Coupon;
    try {
      coupon = await stripe.coupons.retrieve(couponId, { expand: ["applies_to"] });
    } catch (error) {
      if (
        !(error instanceof Stripe.errors.StripeInvalidRequestError) ||
        error.code !== "resource_missing"
      )
        throw error;
      coupon = await stripe.coupons.create(
        {
          id: couponId,
          name: "Partyroom early access",
          percent_off: 100,
          duration: "forever",
          applies_to: { products: [product] },
          expand: ["applies_to"],
        },
        { idempotencyKey: couponId },
      );
    }
    if (
      coupon.percent_off !== 100 ||
      coupon.duration !== "forever" ||
      !coupon.valid ||
      !coupon.applies_to?.products.includes(product)
    ) {
      throw new Error("Early-access coupon must provide 100% off forever for the Premium product");
    }
    let created = 0;
    let skipped = 0;
    for (const recipient of normalized) {
      const matches = await stripe.customers.list({ email: recipient.email, limit: 2 });
      if (matches.data.length > 1)
        throw new Error(
          "Multiple Stripe customers match an import email; resolve the duplicate before retrying",
        );
      const customer =
        matches.data[0] ??
        (await stripe.customers.create(
          {
            ...recipient,
            metadata: { partyroomEarlyAccess: "v1" },
          },
          { idempotencyKey: `partyroom-early-access-customer-${recipient.email}` },
        ));
      let imported = false;
      for await (const subscription of stripe.subscriptions.list({
        customer: customer.id,
        status: "all",
        limit: 100,
      })) {
        if (
          subscription.metadata.partyroomEarlyAccess !== "v1" &&
          subscription.status !== "canceled" &&
          subscription.status !== "incomplete_expired" &&
          subscription.items.data.some((item) => item.price.id === price.id)
        ) {
          throw new Error(
            `Customer ${customer.id} already has a Premium subscription; resolve it before importing`,
          );
        }
        if (subscription.metadata.partyroomEarlyAccess === "v1") {
          imported = true;
          await syncSubscription(ctx, subscription);
        }
      }
      // Canceled imports count as already imported: rerunning cannot restore a revoked grant.
      if (imported) skipped++;
      else {
        const subscription = await stripe.subscriptions.create(
          {
            customer: customer.id,
            items: [{ price: price.id }],
            discounts: [{ coupon: couponId }],
            payment_behavior: "error_if_incomplete",
            metadata: {
              partyroomEarlyAccess: "v1",
              ...(customer.metadata.userId ? { userId: customer.metadata.userId } : {}),
            },
          },
          { idempotencyKey: `partyroom-early-access-subscription-${customer.id}` },
        );
        await syncSubscription(ctx, subscription);
        created++;
      }
      await ctx.runMutation(components.stripe.public.createOrUpdateCustomer, {
        stripeCustomerId: customer.id,
        email: recipient.email,
        name: customer.name ?? undefined,
        metadata: { ...customer.metadata, partyroomEarlyAccess: "v1" },
      });
      await stripe.customers.update(customer.id, { metadata: { partyroomEarlyAccess: "v1" } });
    }
    return { created, skipped };
  },
});
