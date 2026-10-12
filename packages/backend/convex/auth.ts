import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { anonymous } from "better-auth/plugins";
import { generateSlug } from "random-word-slugs";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { type DataModel } from "./_generated/dataModel";
import { capabilities, getCapabilities, isAnonymousUser } from "./capabilities";
import { query, env, type QueryCtx } from "./_generated/server";
import authConfig from "./auth.config";
import { getPremiumAccess } from "./billingAccess";

const siteUrl = env.SITE_URL;

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (convexCtx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: siteUrl,
    trustedOrigins: env.DEV_SITE_URL
      ? [env.DEV_SITE_URL, "http://localhost:5173", "http://127.0.0.1:5173"]
      : [],
    database: authComponent.adapter(convexCtx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    emailVerification: {
      // Existing users request a link with authClient.sendVerificationEmail({ email,
      // callbackURL: "/app" }); after verification, call billingStripe:linkImportedCustomer.
      // Keep sign-in available while the sender is being configured. Premium
      // claims still require a verified email in billingAccess.ts.
      sendOnSignUp: Boolean(
        env.RESEND_API_KEY && env.RESEND_FROM_EMAIL && env.RESEND_TEST_MODE === "false",
      ),
      sendVerificationEmail: async ({ user, url }) => {
        if (!("runMutation" in convexCtx)) {
          throw new Error("Email verification requires a Convex action context");
        }
        // Await durable enqueue, not external delivery.
        await convexCtx.runMutation(internal.email.sendVerification, { email: user.email, url });
      },
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
  returns: v.union(
    v.null(),
    v.object({
      _id: v.string(),
      name: v.union(v.string(), v.null()),
      email: v.union(v.string(), v.null()),
      image: v.union(v.string(), v.null()),
      emailVerified: v.boolean(),
      isAnonymous: v.boolean(),
      capabilities: v.array(
        v.union(...Object.values(capabilities.rooms).map((value) => v.literal(value))),
      ),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUserImpl(ctx);
    const premium = user ? (await getPremiumAccess(ctx, user)).premium : false;
    return user
      ? {
          _id: user._id,
          name: user.name ?? null,
          email: user.email ?? null,
          image: "image" in user && typeof user.image === "string" ? user.image : null,
          emailVerified: "emailVerified" in user && user.emailVerified === true,
          isAnonymous: isAnonymousUser(user),
          capabilities: getCapabilities(user).filter(
            (capability) => capability !== "room:create" || premium,
          ),
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
