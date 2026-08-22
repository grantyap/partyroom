function isLoopbackOrWildcardHost(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::" ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

/**
 * Routes Convex storage through the web app so remote browsers use the same
 * origin and the server can relay byte-range requests to local file storage.
 */
export function browserReachableServiceUrl(value: string, publicServiceUrl: string) {
  try {
    const source = new URL(value);
    const publicService = new URL(publicServiceUrl);
    const belongsToService =
      isLoopbackOrWildcardHost(source.hostname) || source.origin === publicService.origin;
    if (!belongsToService || !source.pathname.startsWith("/api/storage/")) return value;

    return `/api/media${source.pathname}${source.search}${source.hash}`;
  } catch {
    return value;
  }
}
