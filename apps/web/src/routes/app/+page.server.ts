import { capabilities, hasCapability } from "#lib/capabilities.js";
import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, url }) => {
  const { user } = await parent();

  if (!user || user.isAnonymous) {
    redirect(303, `/login?to=${encodeURIComponent(url.pathname + url.search)}`);
  }

  if (!hasCapability(user, capabilities.rooms.list)) {
    error(403, "You do not have permission to view rooms.");
  }
};
