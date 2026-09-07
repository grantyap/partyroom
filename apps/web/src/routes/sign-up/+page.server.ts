import { getCurrentUser } from "$lib/auth.remote";
import { capabilities, hasCapability } from "$lib/capabilities";
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  // Registered users should not see the sign-up form. Anonymous users may
  // convert their current session into a permanent account here.
  const user = await getCurrentUser();
  if (hasCapability(user, capabilities.rooms.create)) {
    const target = url.searchParams.get("to") || "/";
    redirect(303, target);
  }
};
