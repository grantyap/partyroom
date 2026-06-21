import { getToken } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { withServerConvexToken } from "@mmailaender/convex-svelte/sveltekit/server";
import { error, type Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  const token = getToken(event.cookies);
  event.locals.token = token;

  return withServerConvexToken(token, () => {
    if (isAuthenticatedRoute(event.url.pathname) && !token) {
      error(401);
    }

    return resolve(event);
  });
};

function isAuthenticatedRoute(pathname: string) {
  return pathname === "/app" || pathname.startsWith("/app/");
}
