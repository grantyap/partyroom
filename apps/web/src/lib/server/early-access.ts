import { createHmac, timingSafeEqual } from "node:crypto";

export const EARLY_ACCESS_COOKIE = "partyroom_early_access";
export const EARLY_ACCESS_MAX_AGE = 60 * 60 * 24 * 30;

// TODO: browser-scoped grant only; replace with server-side entitlements when payments ship.

function signature(expires: string, secret: string) {
  return createHmac("sha256", secret).update(expires).digest("hex");
}

export function createEarlyAccessToken(secret: string, now = Date.now()) {
  const expires = String(Math.floor(now / 1000) + EARLY_ACCESS_MAX_AGE);
  return `${expires}.${signature(expires, secret)}`;
}

export function hasEarlyAccess(
  token: string | undefined,
  secret: string | undefined,
  now = Date.now(),
) {
  if (!token || !secret) return false;

  const [expires, supplied, extra] = token.split(".");
  if (!expires || !/^\d+$/.test(expires) || !supplied || extra) return false;
  if (Number(expires) < Math.floor(now / 1000)) return false;

  const expected = Buffer.from(signature(expires, secret));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
