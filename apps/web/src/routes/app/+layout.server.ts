import { getCurrentUser } from "#lib/auth.remote.js";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async () => {
  const user = await getCurrentUser();

  return {
    user,
  };
};
