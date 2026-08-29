import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const forwardedRequestHeaders = [
  "range",
  "if-range",
  "if-none-match",
  "if-modified-since",
] as const;

const forwardedResponseHeaders = [
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const;

const proxyStorage: RequestHandler = async ({ params, request, url, fetch }) => {
  const storagePath = `/${params.path ?? ""}`;
  if (!storagePath.startsWith("/api/storage/")) {
    error(404, "Media not found");
  }

  const upstreamUrl = new URL(storagePath, PUBLIC_CONVEX_URL);
  upstreamUrl.search = url.search;

  const requestHeaders = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value) requestHeaders.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: requestHeaders,
      redirect: "manual",
      signal: request.signal,
    });
  } catch (err) {
    // Seeking or changing media sources can make the browser abort a byte-range
    // request it no longer needs. Keep that abort connected to the upstream
    // fetch, but treat the expected client cancellation as a 499 instead of a 500.
    if (request.signal.aborted && err instanceof Error && err.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    throw err;
  }

  const responseHeaders = new Headers();
  for (const name of forwardedResponseHeaders) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("x-content-type-options", "nosniff");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};

export const GET = proxyStorage;
export const HEAD = proxyStorage;
