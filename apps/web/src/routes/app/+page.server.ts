import { capabilities, hasCapability } from "#lib/capabilities.js";
import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent }) => {
  const { user } = await parent();

  if (!user || user.isAnonymous) {
    redirect(303, "/login?to=%2Fapp");
  }

  if (!hasCapability(user, capabilities.rooms.list)) {
    error(403, "You do not have permission to view rooms.");
  }
};
