import { getCurrentUser } from "$lib/auth.remote";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async () => {
  const user = await getCurrentUser();

  return {
    user,
  };
};
