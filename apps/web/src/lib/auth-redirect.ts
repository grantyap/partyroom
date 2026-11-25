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

export function verificationRedirect(target: string) {
  const url = new URL(authRedirect(target), "https://partyroom.invalid");
  url.searchParams.delete("error");
  url.searchParams.set("verification", "success");
  return `${url.pathname}${url.search}${url.hash}`;
}
