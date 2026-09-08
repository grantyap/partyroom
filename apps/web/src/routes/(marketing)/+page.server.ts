import { env } from "$env/dynamic/private";
import { getCurrentUser } from "$lib/auth.remote";
import { capabilities, hasCapability } from "$lib/capabilities";
import {
  createEarlyAccessToken,
  EARLY_ACCESS_COOKIE,
  EARLY_ACCESS_MAX_AGE,
} from "$lib/server/early-access";
import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import type { Actions } from "./$types";

const inviteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
});

const codeSchema = z.string().trim().min(1).max(100);

export const actions: Actions = {
  join: async ({ request, fetch }) => {
    const data = Object.fromEntries(await request.formData());
    const invite = inviteSchema.safeParse(data);

    if (!invite.success) {
      return fail(400, {
        joinError: "Enter your name and a valid email address.",
        name: typeof data.name === "string" ? data.name : "",
        email: typeof data.email === "string" ? data.email : "",
      });
    }

    const { GOOGLE_FORM_ACTION_URL, GOOGLE_FORM_NAME_FIELD, GOOGLE_FORM_EMAIL_FIELD } = env;
    if (!GOOGLE_FORM_ACTION_URL || !GOOGLE_FORM_NAME_FIELD || !GOOGLE_FORM_EMAIL_FIELD) {
      return fail(503, { joinError: "Invites are temporarily unavailable." });
    }

    const response = await fetch(GOOGLE_FORM_ACTION_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        [GOOGLE_FORM_NAME_FIELD]: invite.data.name,
        [GOOGLE_FORM_EMAIL_FIELD]: invite.data.email,
      }),
    }).catch(() => null);

    if (!response?.ok) {
      return fail(502, {
        joinError: "We couldn’t save your invite. Please try again.",
        ...invite.data,
      });
    }

    return { joined: true };
  },

  // TODO(early-access): Remove this action and the Apps Script when paid access replaces codes.
  access: async ({ request, fetch, cookies, url }) => {
    const rawCode = (await request.formData()).get("code");
    const code = codeSchema.safeParse(rawCode);

    if (!code.success) {
      return fail(400, { accessError: "Enter a valid access code." });
    }

    const { GOOGLE_SHEETS_ACCESS_URL, GOOGLE_SHEETS_ACCESS_SECRET } = env;
    if (!GOOGLE_SHEETS_ACCESS_URL || !GOOGLE_SHEETS_ACCESS_SECRET) {
      return fail(503, { accessError: "Access codes are temporarily unavailable." });
    }

    const response = await fetch(GOOGLE_SHEETS_ACCESS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.data, secret: GOOGLE_SHEETS_ACCESS_SECRET }),
    }).catch(() => null);
    const result = await response?.json().catch(() => null);

    if (!response?.ok || !result?.valid) {
      return fail(response?.ok ? 400 : 502, {
        accessError: response?.ok
          ? "That access code isn’t valid."
          : "We couldn’t check that code. Try again.",
        code: code.data,
      });
    }

    cookies.set(EARLY_ACCESS_COOKIE, createEarlyAccessToken(GOOGLE_SHEETS_ACCESS_SECRET), {
      httpOnly: true,
      maxAge: EARLY_ACCESS_MAX_AGE,
      path: "/",
      sameSite: "lax",
      secure: url.protocol === "https:",
    });

    const user = await getCurrentUser();
    redirect(303, hasCapability(user, capabilities.rooms.create) ? "/app" : "/sign-up?to=%2Fapp");
  },
};
