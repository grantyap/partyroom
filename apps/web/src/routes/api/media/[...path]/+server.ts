/**
 * Loads videos, audio, captions, and lyrics from Convex storage through the
 * web app's own URL. This lets browsers reach files even when their original
 * storage URL points to a server-local address, and supports seeking in videos.
 * Files are streamed as they arrive rather than loaded entirely into memory.
 *
 * A production lyrics failure exposed an important trap: server-side fetch
 * decompressed a 1,520-byte gzip response into 13,954 bytes of JSON, but kept
 * the original Content-Length header. Forwarding that length cut the JSON short.
 * We now ask storage for uncompressed data (Accept-Encoding: identity). If it
 * sends compressed data anyway, return 502 instead of risking corrupted files.
 * Removing the length alone would still leave potentially incorrect byte ranges
 * and cache identifiers, so those headers must stay consistent with the bytes.
 *
 * Keep requests limited to a single file on the configured storage server.
 * Check the URL after resolving paths such as "..". Redirects may point only to
 * another file on that server, and must go back through this route. Supporting
 * redirects to an external CDN would require changing this rule and its tests.
 *
 * Copy only the headers listed below. They let browsers request parts of a file
 * for seeking and reuse cached files when appropriate. Never send the browser's
 * cookies or Authorization header to storage. Also omit headers that Connection
 * marks as belonging only to the current network connection.
 *
 * Wait at most 30 seconds for storage to send response headers. Once streaming
 * starts, a long video may take longer; the timer must no longer apply. Cancel
 * the storage request if the browser leaves or switches files. Report connection
 * failures as 502, header timeouts as 504, and browser cancellations as 499.
 * Preserve storage's response status and any stream error. Retrying after some
 * bytes were sent, or treating a broken stream as empty success, can corrupt files.
 *
 * Run these checks from the repository root after changing this route or
 * upgrading Bun, SvelteKit, or the server adapter:
 *   bun test apps/web/src/lib/server/media-proxy.test.ts
 *   bun run --cwd apps/web check
 * The tests use a real local HTTP server to check fetch's compression behavior.
 * After deployment, also compare a lyrics file downloaded directly from storage
 * with the proxied file, and check video seeking. Local tests cannot cover all
 * settings on the production CDN and web server. The lyrics loader currently
 * uses cache: "reload" to replace truncated browser copies from the old proxy;
 * that workaround can be revisited once those cached copies have expired.
 *
 * HTTP rules behind these choices:
 * https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1 (Connection headers)
 * https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6 (Content-Length)
 * https://www.rfc-editor.org/rfc/rfc9110.html#section-14 (Requests for file parts)
 * https://www.rfc-editor.org/rfc/rfc9111.html (Caching)
 *
 * If this needs to support arbitrary servers or more HTTP features, use a
 * dedicated reverse proxy rather than growing this storage route into one.
 */
import { PUBLIC_CONVEX_URL } from "$app/env/public";
import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const forwardedRequestHeaders = [
  "range",
  "if-range",
  "if-none-match",
  "if-modified-since",
  "cache-control",
] as const;

const forwardedResponseHeaders = [
  "accept-ranges",
  "age",
  "cache-control",
  "content-disposition",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "expires",
  "date",
  "last-modified",
  "vary",
  "retry-after",
  "content-language",
] as const;

const storageOrigin = new URL(PUBLIC_CONVEX_URL).origin;
const headerTimeoutMs = 30_000;

function isStorageUrl(url: URL) {
  try {
    return (
      url.origin === storageOrigin &&
      !url.username &&
      !url.password &&
      /^\/api\/storage\/[^/\\?#]+$/.test(decodeURIComponent(url.pathname))
    );
  } catch {
    return false;
  }
}

function connectionHeaders(headers: Headers) {
  return new Set(
    (headers.get("connection") ?? "").split(",").map((name) => name.trim().toLowerCase()),
  );
}

const proxyStorage: RequestHandler = async ({ params, request, url, fetch }) => {
  const storagePath = `/${params.path ?? ""}`;
  if (!storagePath.startsWith("/api/storage/")) {
    error(404, "Media not found");
  }

  const upstreamUrl = new URL(storagePath, PUBLIC_CONVEX_URL);
  upstreamUrl.search = url.search;
  if (!isStorageUrl(upstreamUrl)) error(404, "Media not found");

  const requestHeaders = new Headers();
  // Keep byte lengths and ranges tied to the stored representation.
  requestHeaders.set("accept-encoding", "identity");
  const requestConnectionHeaders = connectionHeaders(request.headers);
  for (const name of forwardedRequestHeaders) {
    if (requestConnectionHeaders.has(name)) continue;
    const value = request.headers.get(name);
    if (value) requestHeaders.set(name, value);
  }

  let upstream: Response;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), headerTimeoutMs);
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: requestHeaders,
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.any([request.signal, timeout.signal]),
    });
  } catch (err) {
    // Seeking or changing media sources can make the browser abort a byte-range
    // request it no longer needs. Keep that abort connected to the upstream
    // fetch, but treat the expected client cancellation as a 499 instead of a 500.
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    console.error("Media storage fetch failed", err);
    error(timeout.signal.aborted ? 504 : 502, "Unable to reach media storage");
  } finally {
    // Bound the wait for headers, not the duration of a media stream.
    clearTimeout(timer);
  }

  // Fetch may decompress without updating lengths, ranges, or validators.
  // Refuse that representation rather than silently forwarding inconsistent data.
  const encoding = upstream.headers.get("content-encoding")?.trim().toLowerCase();
  if (encoding && encoding !== "identity") {
    await upstream.body?.cancel();
    console.error("Media storage ignored identity encoding", { status: upstream.status, encoding });
    error(502, "Media storage returned an unsupported encoding");
  }

  let location: URL | undefined;
  const responseConnectionHeaders = connectionHeaders(upstream.headers);
  if ([301, 302, 303, 307, 308].includes(upstream.status)) {
    try {
      const value = responseConnectionHeaders.has("location")
        ? null
        : upstream.headers.get("location");
      if (value) location = new URL(value, upstreamUrl);
    } catch {
      // Invalid locations are treated like redirects outside storage.
    }
    if (!location || !isStorageUrl(location)) {
      await upstream.body?.cancel();
      console.error("Media storage returned an unsupported redirect");
      error(502, "Media storage returned an unsupported redirect");
    }
  }

  const responseHeaders = new Headers();
  for (const name of forwardedResponseHeaders) {
    if (responseConnectionHeaders.has(name)) continue;
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("x-content-type-options", "nosniff");
  if (location) {
    responseHeaders.set(
      "location",
      `/api/media${location.pathname}${location.search}${location.hash}`,
    );
  }

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};

export const GET = proxyStorage;
export const HEAD = proxyStorage;
