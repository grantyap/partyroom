import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { anonymous } from "better-auth/plugins";
import { generateSlug } from "random-word-slugs";
import { components, internal } from "./_generated/api";
import { type DataModel } from "./_generated/dataModel";
import { getCapabilities, isAnonymousUser } from "./capabilities";
import { query, env, type QueryCtx } from "./_generated/server";
import authConfig from "./auth.config";

const siteUrl = env.SITE_URL;

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (convexCtx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(convexCtx),
    // Configure simple, non-verified email/password to get started
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [
      // The Convex plugin is required for Convex compatibility
      convex({ authConfig }),
      anonymous({
        generateName: () => generateSlug(2, { format: "title" }),
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          if (anonymousUser.user.id === newUser.user.id) {
            return;
          }

          if (!("runMutation" in convexCtx)) {
            throw new Error("Account linking requires a Convex action context");
          }

          await convexCtx.runMutation(internal.userData.migrateUserData, {
            fromUserId: anonymousUser.user.id,
            toUserId: newUser.user.id,
          });
        },
      }),
    ],
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserImpl(ctx);
    return user
      ? {
          ...user,
          isAnonymous: isAnonymousUser(user),
          capabilities: getCapabilities(user),
        }
      : null;
  },
});

export type User = Awaited<ReturnType<typeof authComponent.getAuthUser>>;

/**
 * Gets the currently logged in user.
 *
 * This correctly handles the "Act as user" checkbox in the Convex dashboard.
 */
export async function getCurrentUserImpl(ctx: QueryCtx) {
  try {
    return await authComponent.getAuthUser(ctx);
  } catch (error) {
    const isConvexActAsUserError =
      error instanceof Error && error.message.includes("ArgumentValidationError");
    if (!isConvexActAsUserError) {
      throw error;
    }
  }

  const oldUser = await ctx.auth.getUserIdentity();
  if (!oldUser) {
    return null;
  }
  return { ...oldUser, _id: oldUser.subject };
}
