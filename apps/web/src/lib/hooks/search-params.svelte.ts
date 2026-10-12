import { goto } from "$app/navigation";
import { page } from "$app/state";
import { SvelteMap } from "svelte/reactivity";

type Defaults = Record<string, string | null>;
type Values<T extends Defaults> = { [K in keyof T]: T[K] extends string ? string : string | null };
type QueryPatch = Record<string, string | null>;
export type SearchParamsOptions = { pushHistory?: boolean; hash?: string };

/** Reactive query properties with immediate reads and batched shallow navigation. */
export class SearchParams<T extends Defaults> {
  readonly current: Values<T> = Object.create(null);
  #defaults: T;
  #options: SearchParamsOptions;
  #optimistic = new SvelteMap<string, { value: string | null }>();
  #queuedValues = new Map<string, { value: string | null }>();
  #pending = Promise.resolve();
  #queuedPatch: QueryPatch | null = null;
  #queuedOptions: SearchParamsOptions = {};
  #batchPromise!: Promise<void>;

  constructor(defaults: T, options: SearchParamsOptions = {}) {
    this.#defaults = defaults;
    this.#options = options;
    for (const key of Object.keys(defaults)) {
      Object.defineProperty(this.current, key, {
        enumerable: true,
        get: () => {
          const local = this.#optimistic.get(key);
          return local
            ? local.value
            : ((page.shallow?.url ?? page.url).searchParams.get(key) ?? defaults[key]);
        },
        set: (value: string | null) => {
          void this.update({ [key]: value } as Partial<Values<T>>);
        },
      });
    }
  }

  reset() {
    return this.update(this.#defaults as Values<T>);
  }

  update(values: Partial<Values<T>>, overrides: SearchParamsOptions = {}) {
    const patch: QueryPatch = {};
    for (const [key, value] of Object.entries(values)) {
      if (!Object.hasOwn(this.#defaults, key)) {
        throw new Error(`Unknown search parameter: ${key}`);
      }
      if (value !== null && typeof value !== "string") {
        throw new TypeError(`Invalid search parameter: ${key}`);
      }
      patch[key] = value === this.#defaults[key] ? null : value;
    }

    if (this.#queuedPatch === null) {
      this.#queuedPatch = {};
      this.#queuedOptions = {};
      const previous = this.#pending;

      // Merge synchronous writes, then wait for earlier navigation before reading the URL.
      this.#batchPromise = Promise.resolve().then(() => {
        const patch = this.#queuedPatch!;
        const overrides = this.#queuedOptions;
        const values = this.#queuedValues;
        this.#queuedPatch = null;
        this.#queuedValues = new Map();

        return previous
          .then(() => {
            const url = new URL((page.shallow?.url ?? page.url).href);
            const next = new URL(url);

            for (const [key, value] of Object.entries(patch)) {
              if (value === null) next.searchParams.delete(key);
              else next.searchParams.set(key, value);
            }

            const href = `${next.pathname}${next.search}${overrides.hash ?? this.#options.hash ?? next.hash}`;
            if (href === `${url.pathname}${url.search}${url.hash}`) return;

            return goto(href, {
              shallow: true,
              replace: !(overrides.pushHistory ?? this.#options.pushHistory ?? true),
            });
          })
          .finally(() => {
            // Older navigation must not clear a newer optimistic assignment.
            for (const [key, entry] of values) {
              if (this.#optimistic.get(key) === entry) this.#optimistic.delete(key);
            }
          });
      });

      this.#pending = this.#batchPromise.catch(() => {});
    }

    for (const [key, value] of Object.entries(values)) {
      const entry = { value: value as string | null };
      this.#optimistic.set(key, entry);
      this.#queuedValues.set(key, entry);
    }
    Object.assign(this.#queuedPatch, patch);

    if (overrides.pushHistory !== undefined) {
      this.#queuedOptions.pushHistory = overrides.pushHistory;
    }
    if (overrides.hash !== undefined) {
      this.#queuedOptions.hash = overrides.hash;
    }
    return this.#batchPromise;
  }
}
