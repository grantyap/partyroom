import { expect, mock, spyOn, test } from "bun:test";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";

mock.module("$app/env/public", () => ({ PUBLIC_CONVEX_URL: "https://convex.example.com" }));
const { GET } = await import("../../routes/api/media/[...path]/+server");
type Event = Parameters<typeof GET>[0];
function event(
  fetch: (...args: Parameters<Event["fetch"]>) => ReturnType<Event["fetch"]>,
  options: { path?: string; method?: string; headers?: HeadersInit; signal?: AbortSignal } = {},
): Event {
  return {
    params: { path: options.path ?? "api/storage/lyrics" },
    request: new Request("https://partyroom.example.com/api/media/api/storage/lyrics", {
      method: options.method ?? "GET",
      headers: options.headers,
      signal: options.signal,
    }),
    url: new URL("https://partyroom.example.com/api/media/api/storage/lyrics?component=worker"),
    fetch,
  } as unknown as Event;
}
const upstream = (response: Response) => async () => response;
const lyrics = JSON.stringify({ observations: [{ time: 1, duration: 1, value: "Hello" }] });

test("forwards identity bytes and approved headers, excluding credentials and connection fields", async () => {
  const response = await GET(
    event(
      async (url, options) => {
        expect(String(url)).toBe("https://convex.example.com/api/storage/lyrics?component=worker");
        const headers = new Headers(options?.headers);
        expect(headers.get("accept-encoding")).toBe("identity");
        expect(headers.get("cache-control")).toBe("no-cache");
        for (const name of ["authorization", "cookie", "range"])
          expect(headers.has(name)).toBe(false);
        expect(options?.credentials).toBe("omit");
        expect(options?.redirect).toBe("manual");
        return new Response(lyrics, {
          headers: {
            "content-type": "application/json",
            "content-length": String(lyrics.length),
            "cache-control": "private, max-age=300",
            "set-cookie": "secret=value",
            connection: "keep-alive, expires",
            expires: "Wed, 21 Oct 2026 07:28:00 GMT",
          },
        });
      },
      {
        headers: {
          "cache-control": "no-cache",
          authorization: "Bearer secret",
          cookie: "session=secret",
          connection: "range",
          range: "bytes=0-2",
        },
      },
    ),
  );
  expect(response.headers.get("content-length")).toBe(String(lyrics.length));
  for (const name of ["set-cookie", "connection", "expires", "content-encoding"])
    expect(response.headers.has(name)).toBe(false);
  expect(await response.json()).toEqual(JSON.parse(lyrics));
});

test("rejects compressed full and range responses and cancels their bodies", async () => {
  for (const status of [200, 206])
    for (const encoding of ["gzip", "br", "deflate", "unknown", "gzip, br"]) {
      const response = new Response(lyrics, {
        status,
        headers: { "content-encoding": encoding, "content-length": "20", etag: '"compressed"' },
      });
      await expect(GET(event(upstream(response)))).rejects.toMatchObject({ status: 502 });
      expect(response.bodyUsed).toBe(true);
    }
});

test("preserves range statuses, conditional requests, and cache metadata", async () => {
  for (const status of [206, 304, 416]) {
    const body = status === 206 ? "abc" : null;
    const headers = {
      ...(status === 304 ? {} : { "content-range": status === 416 ? "bytes */9" : "bytes 0-2/9" }),
      "accept-ranges": "bytes",
      etag: '"file"',
      "last-modified": "Wed, 01 Jul 2026 00:00:00 GMT",
      "cache-control": "private, max-age=300",
      age: "40",
      date: "Wed, 01 Jul 2026 00:00:40 GMT",
      vary: "Accept-Encoding",
    };
    const response = await GET(
      event(
        async (_url, options) => {
          const requestHeaders = new Headers(options?.headers);
          for (const [name, value] of Object.entries(conditions))
            expect(requestHeaders.get(name)).toBe(value);
          return new Response(body, { status, headers });
        },
        { headers: conditions },
      ),
    );
    expect(response.status).toBe(status);
    for (const [name, value] of Object.entries(headers))
      expect(response.headers.get(name)).toBe(value);
    expect(await response.text()).toBe(body ?? "");
  }
});
const conditions = {
  range: "bytes=0-2",
  "if-range": '"file"',
  "if-none-match": '"file"',
  "if-modified-since": "Wed, 01 Jul 2026 00:00:00 GMT",
};

test("supports HEAD, empty statuses, multipart ranges, and upstream errors", async () => {
  for (const status of [200, 204, 205, 404, 503]) {
    const response = await GET(
      event(
        upstream(
          new Response(null, {
            status,
            headers: {
              "retry-after": "60",
              ...(status === 200 ? { "content-length": "900" } : {}),
            },
          }),
        ),
        { method: "HEAD" },
      ),
    );
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    expect(response.headers.get("retry-after")).toBe("60");
    if (status === 200) expect(response.headers.get("content-length")).toBe("900");
  }
  const body = "--boundary\r\nContent-Range: bytes 0-2/9\r\n\r\nabc\r\n--boundary--";
  const response = await GET(
    event(
      upstream(
        new Response(body, {
          status: 206,
          headers: { "content-type": "multipart/byteranges; boundary=boundary" },
        }),
      ),
    ),
  );
  expect(response.headers.get("content-type")).toBe("multipart/byteranges; boundary=boundary");
  expect(await response.text()).toBe(body);
});

test("rewrites storage redirects and rejects unsupported destinations", async () => {
  for (const status of [301, 302, 303, 307, 308])
    for (const location of [
      "other?component=worker",
      "https://convex.example.com/api/storage/other?component=worker",
    ]) {
      const response = await GET(
        event(upstream(new Response(null, { status, headers: { location } }))),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("location")).toBe(
        "/api/media/api/storage/other?component=worker",
      );
    }
  for (const location of [
    null,
    "https://outside.example.com/api/storage/file",
    "/version",
    "https://user:pass@convex.example.com/api/storage/file",
    "http://[",
    "/api/storage/%2Fother",
  ]) {
    await expect(
      GET(
        event(upstream(new Response(null, { status: 302, headers: location ? { location } : {} }))),
      ),
    ).rejects.toMatchObject({ status: 502 });
  }
});

test("validates normalized storage paths before fetching", async () => {
  const fetch = mock(async () => new Response("unexpected"));
  for (const path of [
    "version",
    "api/storage/../../version",
    "api/storage/%2e%2e/version",
    "api/storage/%2fother",
    "api/storage/",
    "api/storage/file/other",
    "api/storage/%",
    "api/storage/%5cother",
  ]) {
    await expect(GET(event(fetch, { path }))).rejects.toMatchObject({
      status: 404,
    });
  }
  expect(fetch).not.toHaveBeenCalled();
});

test("returns 502 for outages and 499 for cancellation with any abort reason", async () => {
  await expect(
    GET(
      event(async () => {
        throw new TypeError("Connection failed");
      }),
    ),
  ).rejects.toMatchObject({ status: 502 });
  const controller = new AbortController();
  controller.abort("client left");
  const response = await GET(
    event(
      async (_url, options) => {
        options?.signal?.throwIfAborted();
        throw new Error("Expected cancellation");
      },
      { signal: controller.signal },
    ),
  );
  expect(response.status).toBe(499);
});

test("times out header waits while preserving cancellation after headers", async () => {
  const realSetTimeout = globalThis.setTimeout;
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) =>
    realSetTimeout(fn, 1)) as typeof setTimeout);
  try {
    await expect(
      GET(
        event(
          async (_url, options) =>
            new Promise((_resolve, reject) => {
              options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
                once: true,
              });
            }),
        ),
      ),
    ).rejects.toMatchObject({ status: 504 });
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | null | undefined;
    await GET(
      event(
        async (_url, options) => {
          upstreamSignal = options?.signal;
          return new Response("stream");
        },
        { signal: controller.signal },
      ),
    );
    // Wait past the shortened deadline: a resolved header wait must clear it.
    await new Promise<void>((resolve) => realSetTimeout(resolve, 10));
    expect(upstreamSignal?.aborted).toBe(false);
    controller.abort();
    expect(upstreamSignal?.aborted).toBe(true);
  } finally {
    timer.mockRestore();
  }
});

test("checks real HTTP fetch behavior with identity and gzip responses", async () => {
  const server = createServer((request, response) => {
    const encoded = request.url?.includes("encoded");
    const body = encoded ? gzipSync(lyrics) : Buffer.from(lyrics);
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": String(body.length),
      ...(encoded ? { "content-encoding": "gzip" } : {}),
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP fixture address");
  try {
    for (const path of ["lyrics", "encoded"]) {
      const result = GET(
        event(async (_url, options) => fetch(`http://127.0.0.1:${address.port}/${path}`, options)),
      );
      if (path === "encoded") await expect(result).rejects.toMatchObject({ status: 502 });
      else expect(await (await result).json()).toEqual(JSON.parse(lyrics));
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeAllConnections();
    });
  }
});

test("stream failures reach the consumer instead of becoming successful empty bodies", async () => {
  const failure = new Error("Upstream body disconnected");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("partial"));
    },
    pull(controller) {
      controller.error(failure);
    },
  });
  const response = await GET(event(upstream(new Response(body))));
  await expect(response.text()).rejects.toBe(failure);
});
