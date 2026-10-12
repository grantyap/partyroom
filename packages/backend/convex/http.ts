import { httpRouter } from "convex/server";
import { registerRoutes } from "@convex-dev/stripe";
import { components } from "./_generated/api";
import { handleBillingEvent } from "./billingStripe";
import { authComponent, createAuth } from "./auth";
import { webhook as resendWebhook } from "./email";
import {
  artifactRegister as registerActivityArtifact,
  artifactUploadUrl as activityArtifactUploadUrl,
  cancel as cancelActivity,
  claim as claimActivity,
  complete as completeActivity,
  fail as failActivity,
  renew as renewActivity,
  mediaSource as activityMediaSource,
} from "./activities/http";

const http = httpRouter();
// Stripe destination: <public Convex HTTP origin>/stripe/webhook (local port 3211).
// Subscribe to customer.created/updated/deleted, customer.subscription.created/updated/deleted,
// checkout.session.completed, and invoice.created/finalized/updated/paid/payment_failed.
// Self-hosted deployments use their own HTTP origin; locally use the dev webhook tunnel.
registerRoutes(http, components.stripe, { onEvent: handleBillingEvent });

authComponent.registerRoutes(http, createAuth);
// Resend destination: <public Convex HTTP origin>/resend/webhook; subscribe to all email.* events.
http.route({ path: "/resend/webhook", method: "POST", handler: resendWebhook });
http.route({
  path: "/activities/workers/claim",
  method: "POST",
  handler: claimActivity,
});
http.route({
  path: "/activities/workers/artifact-upload-url",
  method: "POST",
  handler: activityArtifactUploadUrl,
});
http.route({
  path: "/activities/workers/artifact-register",
  method: "POST",
  handler: registerActivityArtifact,
});
http.route({
  path: "/activities/workers/renew",
  method: "POST",
  handler: renewActivity,
});
http.route({
  path: "/activities/workers/complete",
  method: "POST",
  handler: completeActivity,
});
http.route({
  path: "/activities/workers/fail",
  method: "POST",
  handler: failActivity,
});
http.route({
  path: "/activities/workers/cancel",
  method: "POST",
  handler: cancelActivity,
});
http.route({
  path: "/activities/workers/media-source",
  method: "POST",
  handler: activityMediaSource,
});

export default http;
