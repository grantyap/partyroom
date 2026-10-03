import { defineEnvVars } from "@sveltejs/kit/env";

// Optional integration settings stay empty when unset so the actions can return 503.
export const variables = defineEnvVars({
  PUBLIC_CONVEX_URL: { public: true, static: true },
  GOOGLE_FORM_ACTION_URL: { schema: (input) => input ?? "" },
  GOOGLE_FORM_NAME_FIELD: { schema: (input) => input ?? "" },
  GOOGLE_FORM_EMAIL_FIELD: { schema: (input) => input ?? "" },
  GOOGLE_SHEETS_ACCESS_URL: { schema: (input) => input ?? "" },
  GOOGLE_SHEETS_ACCESS_SECRET: { schema: (input) => input ?? "" },
  PUBLIC_CONVEX_SITE_URL: { public: true, static: true },
  PUBLIC_FEEDBACK_FORM_URL: { public: true, static: true },
});
