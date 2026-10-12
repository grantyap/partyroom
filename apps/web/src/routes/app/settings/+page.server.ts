import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, url }) => {
  const { user } = await parent();
  if (!user || user.isAnonymous) {
    redirect(303, `/login?to=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return {};
};
