import { getCurrentUser } from "$lib/auth.remote";
import { capabilities, hasCapability } from "$lib/capabilities";
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  // Registered users should not see the login form. Anonymous users may use it
  // to link a permanent authentication method to their current session.
  const user = await getCurrentUser();
  if (hasCapability(user, capabilities.rooms.create)) {
    const target = url.searchParams.get("to") || "/";
    redirect(303, target);
  }
};
