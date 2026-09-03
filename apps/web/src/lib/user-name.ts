import { authClient } from "$lib/auth-client";
import z from "zod";

export const USER_NAME_MAX_LENGTH = 50;
const USER_NAME_SET_STORAGE_PREFIX = "partyroom:user-name-set:";

export const userNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name to continue.")
  .max(USER_NAME_MAX_LENGTH, `Names must be ${USER_NAME_MAX_LENGTH} characters or fewer.`)
  .refine(
    (name) => !/^(anonymous|guest)$/i.test(name),
    "Choose a name other than Guest or Anonymous.",
  );

export function normalizeUserName(name: string) {
  return name.trim();
}

export function isMeaningfulUserName(name: string | null | undefined) {
  const normalizedName = normalizeUserName(name ?? "").toLowerCase();
  return normalizedName !== "" && normalizedName !== "anonymous" && normalizedName !== "guest";
}

export function hasStoredUserName(userId: string) {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(`${USER_NAME_SET_STORAGE_PREFIX}${userId}`) === "true";
  } catch {
    return false;
  }
}

function rememberUserNameSet(userId: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(`${USER_NAME_SET_STORAGE_PREFIX}${userId}`, "true");
  } catch {
    // Storage failures should not prevent the Better Auth update from succeeding.
  }
}

export async function setUserName(input: string, userId?: string) {
  const parsedName = userNameSchema.safeParse(input);
  if (!parsedName.success) {
    throw new Error(parsedName.error.issues[0]?.message ?? "Enter a name to continue.");
  }

  const result = await authClient.updateUser({ name: parsedName.data });
  if (result.error) {
    throw new Error(result.error.message);
  }

  if (userId) {
    rememberUserNameSet(userId);
  }

  return parsedName.data;
}
