import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";
import presence from "@convex-dev/presence/convex.config.js";
import { v } from "convex/values";

const app = defineApp({
  env: {
    SITE_URL: v.string(),
  },
});
app.use(betterAuth);
app.use(presence);

export default app;
