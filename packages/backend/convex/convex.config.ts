import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";
import migrations from "@convex-dev/migrations/convex.config.js";
import presence from "@convex-dev/presence/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";
import activities from "@partyroom/activities/convex.config";
import stripe from "@convex-dev/stripe/convex.config.js";
import resend from "@convex-dev/resend/convex.config.js";
import { v } from "convex/values";

const app = defineApp({
  env: {
    SITE_URL: v.string(),
    DEV_SITE_URL: v.optional(v.string()),
    ACTIVITY_WORKER_TOKEN: v.string(),
    WORKER_CONVEX_CLOUD_ORIGIN: v.string(),
    WORKER_SIGNING_SECRET: v.string(),
    STRIPE_SECRET_KEY: v.optional(v.string()),
    STRIPE_WEBHOOK_SECRET: v.optional(v.string()),
    STRIPE_PREMIUM_PRICE_ID: v.optional(v.string()),
    RESEND_API_KEY: v.optional(v.string()),
    RESEND_FROM_EMAIL: v.optional(v.string()),
    RESEND_WEBHOOK_SECRET: v.optional(v.string()),
    RESEND_TEST_MODE: v.optional(v.union(v.literal("true"), v.literal("false"))),
  },
});
app.use(betterAuth);
app.use(migrations);
app.use(presence);
app.use(workflow);
app.use(activities);
app.use(stripe);
app.use(resend);

export default app;
