import { requireCurrentUser } from "$lib/auth.remote";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
	const user = await requireCurrentUser();

	return { user };
};
