import { components } from "./_generated/api";
import { env, type MutationCtx, type QueryCtx } from "./_generated/server";
import { isAnonymousUser } from "./capabilities";

export const RENEWAL_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

type BillingUser = {
  _id: string;
  email?: string;
  emailVerified?: boolean;
  isAnonymous?: boolean | null;
};

export async function getBillingCustomer(ctx: QueryCtx, user: BillingUser) {
  if (isAnonymousUser(user)) return null;
  const linked = await ctx.runQuery(components.stripe.public.getCustomerByUserId, {
    userId: user._id,
  });
  if (linked) return linked;
  // A signup's self-reported email must never claim somebody else's subscription.
  if (!user.emailVerified || !user.email) return null;
  const imported = await ctx.runQuery(components.stripe.public.getCustomerByEmail, {
    email: user.email.trim().toLowerCase(),
  });
  return imported && (!imported.userId || imported.userId === user._id) ? imported : null;
}

export function subscriptionAccessUntil(
  subscription: {
    status: string;
    priceId: string;
    currentPeriodEnd: number;
    cancelAt?: number;
  },
  priceId: string,
  renewal: { firstFailureAt?: number; paid: boolean; expired: boolean } | null,
) {
  if (subscription.priceId !== priceId) return 0;
  const cancellation = subscription.cancelAt ? subscription.cancelAt * 1000 : Infinity;
  if (subscription.status === "active") {
    return Math.min(subscription.currentPeriodEnd * 1000, cancellation);
  }
  if (
    (subscription.status === "past_due" || subscription.status === "unpaid") &&
    renewal?.firstFailureAt !== undefined &&
    !renewal.paid &&
    !renewal.expired
  ) {
    return Math.min(renewal.firstFailureAt + RENEWAL_GRACE_MS, cancellation);
  }
  // Initial incomplete payments, canceled subscriptions and trials do not grant Premium.
  return 0;
}

export async function getPremiumAccess(ctx: QueryCtx, user: BillingUser) {
  if (!env.STRIPE_PREMIUM_PRICE_ID || isAnonymousUser(user))
    return { premium: false, accessUntil: 0 };
  const customer = await getBillingCustomer(ctx, user);
  if (!customer) return { premium: false, accessUntil: 0 };
  const subscriptions = await ctx.runQuery(components.stripe.public.listSubscriptions, {
    stripeCustomerId: customer.stripeCustomerId,
  });
  let accessUntil = 0;
  for (const subscription of subscriptions) {
    const period = await ctx.db
      .query("billingPeriods")
      .withIndex("by_subscription", (q) =>
        q.eq("stripeSubscriptionId", subscription.stripeSubscriptionId),
      )
      .unique();
    const renewal = await ctx.db
      .query("billingRenewals")
      .withIndex("by_subscription_and_created", (q) =>
        q.eq("stripeSubscriptionId", subscription.stripeSubscriptionId),
      )
      .order("desc")
      .first();
    const deadline = subscriptionAccessUntil(subscription, env.STRIPE_PREMIUM_PRICE_ID, renewal);
    if (period?.expired && period.expiresAt === deadline) continue;
    accessUntil = Math.max(accessUntil, deadline);
  }
  // Scheduled expiry writes invalidate subscribers; queries never depend on the wall clock.
  return { premium: accessUntil > 0, accessUntil };
}

export async function requirePremium(ctx: QueryCtx | MutationCtx, user: BillingUser) {
  const access = await getPremiumAccess(ctx, user);
  // Mutations enforce the exact deadline even if the scheduled expiry write is delayed.
  if (!access.premium || ("scheduler" in ctx && access.accessUntil <= Date.now()))
    throw new Error("Premium subscription required");
}
