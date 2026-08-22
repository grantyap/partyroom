import { createConvexHttpClient } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { api } from "@partyroom/backend/convex/_generated/api";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, parent }) => {
  const { roomName } = params;

  const client = createConvexHttpClient();

  const [room, user] = await Promise.all([
    (async () => {
      try {
        return await client.mutation(api.rooms.recordRoomVisitByName, { name: roomName });
      } catch (err) {
        if (!(err instanceof Error)) {
          throw err;
        }

        // TODO: Maybe create a custom AppError so we can statically check this.
        if (err.message.toLowerCase().includes("room not found")) {
          error(404, "Not Found");
        }

        throw err;
      }
    })(),
    parent().then(({ user }) => {
      if (!user) {
        error(401);
      }

      return user;
    }),
  ]);

  return {
    room,
    user,
  };
};
