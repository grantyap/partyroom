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

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers: requestHeaders,
    redirect: "manual",
    signal: request.signal,
  });

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
