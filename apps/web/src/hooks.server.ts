import { redirect } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { getToken } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { withServerConvexToken } from "convex-svelte/sveltekit/server";

export const handle: Handle = async ({ event, resolve }) => {
  const token = getToken(event.cookies);
  event.locals.token = token;

  return withServerConvexToken(token, () => {
    if (isAuthenticatedRoute(event.url.pathname) && !token && !isRoomRoute(event.url.pathname)) {
      redirect(302, `/login?to=${encodeURIComponent(event.url.pathname + event.url.search)}`);
    }

    return resolve(event);
  });
};

function isAuthenticatedRoute(pathname: string) {
  return pathname === "/app" || pathname.startsWith("/app/");
}

function isRoomRoute(pathname: string) {
  return /^\/app\/rooms\/[^/]+\/?$/.test(pathname);
}
