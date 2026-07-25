import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";
import presence from "@convex-dev/presence/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";
import activities from "@partyroom/activities/convex.config";
import { v } from "convex/values";

const app = defineApp({
  env: {
    SITE_URL: v.string(),
    ACTIVITY_WORKER_TOKEN: v.string(),
    WORKER_CONVEX_CLOUD_ORIGIN: v.string(),
    WORKER_SIGNING_SECRET: v.string(),
  },
});
app.use(betterAuth);
app.use(presence);
app.use(workflow);
app.use(activities);

export default app;
