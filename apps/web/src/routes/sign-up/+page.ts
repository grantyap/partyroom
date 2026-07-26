import { signUpSchema } from "$lib/components/auth/form-schema";
import { superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
  const form = await superValidate(zod4(signUpSchema));

  return { form };
};
