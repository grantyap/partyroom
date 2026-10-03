import { redirect } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { dev } from "$app/env";
import { GOOGLE_SHEETS_ACCESS_SECRET } from "$app/env/private";
import { EARLY_ACCESS_COOKIE, hasEarlyAccess } from "#lib/server/early-access.js";
import { getToken } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { withServerConvexToken } from "convex-svelte/sveltekit/server";

export const handle: Handle = async ({ event, resolve }) => {
  const token = getToken(event.cookies);
  event.locals.token = token;

  return withServerConvexToken(token, () => {
    if (
      !dev &&
      isEarlyAccessRoute(event.url.pathname) &&
      !hasEarlyAccess(event.cookies.get(EARLY_ACCESS_COOKIE), GOOGLE_SHEETS_ACCESS_SECRET)
    ) {
      redirect(302, "/?access=required");
    }

    if (isAuthenticatedRoute(event.url.pathname) && !token && !isRoomRoute(event.url.pathname)) {
      redirect(302, `/login?to=${encodeURIComponent(event.url.pathname)}`);
    }

    return resolve(event);
  });
};

function isEarlyAccessRoute(pathname: string) {
  return pathname === "/sign-up" || (isAuthenticatedRoute(pathname) && !isRoomRoute(pathname));
}

function isAuthenticatedRoute(pathname: string) {
  return pathname === "/app" || pathname.startsWith("/app/");
}

function isRoomRoute(pathname: string) {
  return /^\/app\/rooms\/[^/]+\/?$/.test(pathname);
}
