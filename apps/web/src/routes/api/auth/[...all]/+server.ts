import { createSvelteKitHandler } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { PUBLIC_CONVEX_SITE_URL } from "$env/static/public";
import type { RequestHandler } from "./$types";

const handlers = createSvelteKitHandler();

// Just use the default GET handler.
export const GET = handlers.GET;

// The POST handler is reimplemented to bypass a bug in Node/Bun's undici fetch layer (v24.14+/v25+).
// The library's inner `new Request(url, request)` reconstructs a streaming body that locks.
// When Convex returns a 401/404, undici crashes with `expected non-null body source`.
// Materializing the body buffer and bypassing `new Request` allows error responses to pass.
export const POST: RequestHandler = async ({ request, fetch }) => {
  const requestUrl = new URL(request.url);

  if (!PUBLIC_CONVEX_SITE_URL) {
    throw new Error("PUBLIC_CONVEX_SITE_URL environment variable is not set");
  }

  // 1. Manually resolve the exact upstream endpoint URL targeting Convex
  const targetUrl = `${PUBLIC_CONVEX_SITE_URL}${requestUrl.pathname}${requestUrl.search}`;

  // 2. Buffer the incoming client payload safely into a static array memory space
  const bodyBuffer = await request.arrayBuffer();

  // 3. Duplicate and re-map necessary headers
  const cleanHeaders = new Headers();
  for (const [key, value] of request.headers.entries()) {
    // Retain authentication or essential state properties
    if (!key.toLowerCase().startsWith("host")) {
      cleanHeaders.set(key, value);
    }
  }

  // 4. Force a clean fetch without wrapping it in a secondary 'new Request()' instance
  return await fetch(targetUrl, {
    method: "POST",
    headers: cleanHeaders,
    body: bodyBuffer,
    redirect: "manual",
    // @ts-ignore - Required in some runtimes to indicate static non-streaming bodies
    duplex: "half",
  });
};
