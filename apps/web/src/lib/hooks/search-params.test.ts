import { expect, mock, test } from "bun:test";

let readUrl: () => URL;
let navigate: (href: string, replace: boolean) => Promise<void>;
let shallowUrl: URL | null = null;
mock.module("$app/state", () => ({
  page: {
    get url() {
      return readUrl();
    },
    get shallow() {
      return shallowUrl ? { url: shallowUrl } : null;
    },
  },
}));
mock.module("$app/navigation", () => ({
  goto: (href: string, options: { shallow: boolean; replace: boolean }) => {
    expect(options.shallow).toBe(true);
    return navigate(href, options.replace);
  },
}));
const { SearchParams } = await import("./search-params.svelte");

function createSearchParams<T extends Record<string, string | null>>(
  defaults: T,
  getUrl: () => URL,
  go: (href: string, replace: boolean) => Promise<void>,
  options: { pushHistory?: boolean; hash?: string } = {},
) {
  readUrl = getUrl;
  navigate = go;
  shallowUrl = null;
  return new SearchParams(defaults, options);
}

test("properties read the current URL, assignments navigate, and external history stays authoritative", async () => {
  let url = new URL("https://partyroom.invalid/app/rooms/party?queue=next#chat");
  const navigations: boolean[] = [];
  const params = createSearchParams(
    { billing: null, filter: "all" },
    () => url,
    async (href, replace) => {
      navigations.push(replace);
      url = new URL(href, url);
    },
  );
  expect(params.current.billing).toBeNull();
  expect(params.current.filter).toBe("all");
  params.current.billing = "";
  expect(params.current.billing).toBe("");
  expect(url.searchParams.has("billing")).toBe(false);
  await params.update({});
  expect(url.href).toBe("https://partyroom.invalid/app/rooms/party?queue=next&billing=#chat");
  expect(params.current.billing).toBe("");
  await params.update({ billing: "success", filter: "mine" }, { pushHistory: false });
  expect(params.current.billing).toBe("success");
  expect(navigations).toEqual([false, true]);
  url = new URL("https://partyroom.invalid/app?billing=canceled");
  expect(params.current.billing).toBe("canceled");
  expect(params.current.filter).toBe("all");
  await params.reset();
  expect(url.search).toBe("");
});

test("batch updates clear outcomes together while preserving other parameters", async () => {
  let url = new URL(
    "https://partyroom.invalid/app?billing=success&error=expired&queue=next#premium",
  );
  let calls = 0;
  const params = createSearchParams(
    { billing: null, error: null },
    () => url,
    async (href, replace) => {
      calls++;
      expect(replace).toBe(true);
      url = new URL(href, url);
    },
    { pushHistory: false },
  );
  await params.update({ billing: null, error: null }, { hash: "" });
  expect(url.href).toBe("https://partyroom.invalid/app?queue=next");
  expect(calls).toBe(1);
});

test("invalid updates cannot overwrite unrelated query state", () => {
  const url = new URL("https://partyroom.invalid/app");
  const navigate = async () => {
    throw new Error("must not navigate");
  };
  const params = createSearchParams({ billing: null }, () => url, navigate);
  // @ts-expect-error Only declared parameters are writable.
  expect(() => params.update({ unknown: "value" })).toThrow("Unknown");
  // @ts-expect-error This API stores strings or null, not arbitrary objects.
  expect(() => params.update({ billing: {} })).toThrow("Invalid");
});

test("same-turn property writes share one navigation even when navigation resolves asynchronously", async () => {
  let url = new URL("https://partyroom.invalid/app?queue=next");
  let navigations = 0;
  const params = createSearchParams(
    { billing: null, error: null },
    () => url,
    async (href) => {
      navigations++;
      await Promise.resolve();
      url = new URL(href, url);
    },
  );
  params.current.billing = "";
  params.current.error = "expired";
  await params.update({});
  expect(url.searchParams.get("queue")).toBe("next");
  expect(params.current.billing).toBe("");
  expect(params.current.error).toBe("expired");
  expect(navigations).toBe(1);
});

test("same-turn updates share a promise, last values and explicit navigation options win", async () => {
  let url = new URL("https://partyroom.invalid/app?billing=success&queue=next#chat");
  const navigations: boolean[] = [];
  const params = createSearchParams(
    { billing: null, error: null },
    () => url,
    async (href, replace) => {
      navigations.push(replace);
      url = new URL(href, url);
    },
  );
  const first = params.update({ billing: "canceled", error: "expired" }, { pushHistory: true });
  const last = params.update({ billing: null, error: null }, { pushHistory: false });
  expect(first).toBe(last);
  await last;
  expect(url.href).toBe("https://partyroom.invalid/app?queue=next#chat");
  expect(navigations).toEqual([true]);
  const noop = params.update({ billing: "" });
  params.current.billing = null;
  await noop;
  expect(navigations).toEqual([true]);
});

test("writes arriving during a navigation wait and preserve its parameters", async () => {
  let url = new URL("https://partyroom.invalid/app?queue=next");
  let finishFirst!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  let calls = 0;
  const params = createSearchParams(
    { billing: null, error: null },
    () => url,
    async (href) => {
      calls++;
      if (calls === 1) {
        markStarted();
        await paused;
      }
      url = new URL(href, url);
    },
  );
  const first = params.update({ billing: "" });
  await started;
  const second = params.update({ error: "expired" });
  finishFirst();
  await Promise.all([first, second]);
  expect(calls).toBe(2);
  expect(params.current.billing).toBe("");
  expect(params.current.error).toBe("expired");
  expect(url.searchParams.get("queue")).toBe("next");
});

test("a failed batch rejects its callers but does not block later updates", async () => {
  let url = new URL("https://partyroom.invalid/app");
  let calls = 0;
  const params = createSearchParams(
    { billing: null },
    () => url,
    async (href) => {
      if (++calls === 1) throw new Error("navigation failed");
      url = new URL(href, url);
    },
  );
  const failed = params.update({ billing: "success" });
  expect(params.current.billing).toBe("success");
  await expect(failed).rejects.toThrow("navigation failed");
  expect(params.current.billing).toBeNull();
  await params.update({ billing: "" });
  expect(params.current.billing).toBe("");
});

test("older completion cannot clear a newer optimistic value for the same key", async () => {
  let url = new URL("https://partyroom.invalid/app?billing=old");
  const releases: (() => void)[] = [];
  const params = createSearchParams(
    { billing: null },
    () => url,
    async (href) => {
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      url = new URL(href, url);
    },
  );
  const first = params.update({ billing: "first" });
  while (releases.length === 0) await Promise.resolve();
  const second = params.update({ billing: "second" });
  expect(params.current.billing).toBe("second");
  releases[0]!();
  await first;
  expect(params.current.billing).toBe("second");
  while (releases.length < 2) await Promise.resolve();
  releases[1]!();
  await second;
  url = new URL("https://partyroom.invalid/app?billing=back");
  expect(params.current.billing).toBe("back");
});

test("reset and removal read their defaults immediately, before URL synchronization", async () => {
  let url = new URL("https://partyroom.invalid/app?billing=success&filter=mine&queue=next");
  const params = createSearchParams(
    { billing: null, filter: "all" },
    () => url,
    async (href) => {
      url = new URL(href, url);
    },
  );
  const reset = params.reset();
  expect(params.current.billing).toBeNull();
  expect(params.current.filter).toBe("all");
  expect(url.searchParams.get("filter")).toBe("mine");
  await reset;
  expect(url.search).toBe("?queue=next");
});

test("reads and writes use the visible shallow URL, preserving encoded values and hashes", async () => {
  const background = new URL("https://partyroom.invalid/app?queue=background");
  const params = createSearchParams(
    { billing: null, filter: "all" },
    () => background,
    async (href) => {
      shallowUrl = new URL(href, background);
    },
  );
  shallowUrl = new URL("https://partyroom.invalid/app/rooms/party?queue=next&billing=success#chat");
  expect(params.current.billing).toBe("success");
  await params.update({ billing: "", filter: "a & b" });
  expect(shallowUrl!.href).toBe(
    "https://partyroom.invalid/app/rooms/party?queue=next&billing=&filter=a+%26+b#chat",
  );
  expect(background.search).toBe("?queue=background");
});
