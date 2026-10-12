/** Auth return URLs must stay on this app, including after URL normalization. */
export function authRedirect(target: string | null) {
  try {
    const origin = "https://partyroom.invalid";
    const url = new URL(target || "/app", origin);
    return url.origin === origin && !["/login", "/sign-up"].includes(url.pathname)
      ? `${url.pathname}${url.search}${url.hash}`
      : "/app";
  } catch {
    return "/app";
  }
}
