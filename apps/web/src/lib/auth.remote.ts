import { query } from "$app/server";
import {
  getAuthState as convexBetterAuthGetAuthState,
  createConvexHttpClient,
} from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { api } from "@partyroom/backend/convex/_generated/api";
import { error } from "@sveltejs/kit";

export const getCurrentUser = query(async () => {
  const authState = convexBetterAuthGetAuthState();

  if (!authState.isAuthenticated) {
    return null;
  }

  const client = createConvexHttpClient();

  try {
    const user = await client.query(api.auth.getCurrentUser, {});
    return user;
  } catch {
    return null;
  }
});

export const requireCurrentUser = query(async () => {
  const user = await getCurrentUser();
  if (!user) {
    error(401);
  }
  return user;
});
