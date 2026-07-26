import { getAuthState } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  // If the user's already logged in, then redirect to the app home page.
  const { isAuthenticated } = getAuthState();
  if (isAuthenticated) {
    const target = url.searchParams.get("to") || "/";
    redirect(303, target);
  }
};
