import { superValidate } from "sveltekit-superforms";
import type { PageLoad } from "./$types";
import { zod4 } from "sveltekit-superforms/adapters";
import { signUpSchema } from "$lib/components/auth/form-schema";
import { convexLoad } from "convex-svelte/sveltekit";
import { api } from "@partyroom/backend/convex/_generated/api";
import { redirect } from "@sveltejs/kit";
import { getAuthState } from "@mmailaender/convex-better-auth-svelte/sveltekit";

export const load: PageLoad = async () => {
  const form = await superValidate(zod4(signUpSchema));

  return { form };
};
