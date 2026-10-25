import { authRedirect } from "#lib/auth-redirect.js";
import { getCurrentUser } from "#lib/auth.remote.js";
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  // Registered users should not see the sign-up form. Anonymous users may
  // convert their current session into a permanent account here.
  const user = await getCurrentUser();
  if (user && !user.isAnonymous) {
    const target = authRedirect(url.searchParams.get("to"));
    redirect(303, target);
  }
};
