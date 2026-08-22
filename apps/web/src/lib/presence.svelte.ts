import { api } from "@partyroom/backend/convex/_generated/api";
import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
import { getConvexClient } from "convex-svelte";
import type { FunctionReturnType } from "convex/server";
import { createUuidInAnyContext } from "./context-uuid";

/**
 * Presence state for a user within the given room.
 */
export type PresenceState = FunctionReturnType<(typeof api.presence)["list"]>[number];

/**
 * State class for maintaining presence state.
 * This class is designed to be efficient and only sends a message to users
 * whenever a member joins or leaves the room, not on every heartbeat.
 *
 * @see Adapted from {@link https://github.com/get-convex/presence/blob/main/src/react/index.ts}
 */
export class Presence {
  readonly #client = getConvexClient();

  readonly #roomId;
  readonly #userId;
  readonly #intervalMs;
  readonly #convexUrl?: string;

  readonly #heartbeat;
  readonly #disconnect;

  #sessionId = $state(createUuidInAnyContext());
  #sessionToken = $state<string | null>(null);
  #roomToken = $state<string | null>(null);

  #interval: ReturnType<typeof setInterval> | null = null;

  #state = $state<PresenceState[]>();

  constructor({
    roomId,
    userId,
    interval = 10_000,
    convexUrl,
  }: {
    roomId: string;
    userId: string;
    interval?: number;
    convexUrl?: string;
  }) {
    this.#roomId = roomId;
    this.#userId = userId;
    this.#intervalMs = interval;
    this.#convexUrl = convexUrl;

    this.#heartbeat = singleFlight(async () => {
      const result = await this.#client.mutation(api.presence.heartbeat, {
        room: roomId as Id<"rooms">,
        session: this.#sessionId,
        interval: interval,
      });

      this.#roomToken = result.roomToken;
      this.#sessionToken = result.sessionToken;
    });

    this.#disconnect = singleFlight(async () => {
      if (!this.#sessionToken) return;

      await this.#client.mutation(api.presence.disconnect, {
        sessionToken: this.#sessionToken,
        room: this.roomId as Id<"rooms">,
      });

      this.#sessionToken = null;
      this.#roomToken = null;
    });

    $effect.root(() => {
      // Restart whenever room/user/interval changes.
      $effect(() => {
        // oxlint-disable-next-line no-unused-expressions -- Used to trigger effect.
        this.roomId;
        // oxlint-disable-next-line no-unused-expressions -- Used to trigger effect.
        this.userId;
        // oxlint-disable-next-line no-unused-expressions -- Used to trigger effect.
        this.interval;

        this.#reset();

        return () => {
          void this.#disconnect();
          this.#stopHeartbeat();
        };
      });

      // Subscribe to presence list.
      $effect(() => {
        if (!this.#roomToken) {
          this.#state = undefined;
          return;
        }

        return this.#client.onUpdate(api.presence.list, { roomToken: this.#roomToken }, (users) => {
          this.#state = [...users].sort((a, b) => {
            if (a.userId === this.userId) return -1;
            if (b.userId === this.userId) return 1;
            return 0;
          });
        });
      });

      // Visibility.
      const onVisibility = async () => {
        if (document.hidden) {
          this.#stopHeartbeat();
          await this.#disconnect();
        } else {
          await this.#heartbeat();
          this.#startHeartbeat();
        }
      };

      document.addEventListener("visibilitychange", onVisibility);

      // Unload.
      const onUnload = () => {
        if (!this.#sessionToken) return;

        navigator.sendBeacon(
          `${this.convexUrl}/api/mutation`,
          new Blob(
            [
              JSON.stringify({
                path: "presence:disconnect",
                args: {
                  sessionToken: this.#sessionToken,
                  room: this.roomId,
                },
              }),
            ],
            { type: "application/json" },
          ),
        );
      };

      window.addEventListener("beforeunload", onUnload);

      return () => {
        document.removeEventListener("visibilitychange", onVisibility);

        window.removeEventListener("beforeunload", onUnload);

        this.#stopHeartbeat();
        void this.#disconnect();
      };
    });
  }

  get roomId() {
    return this.#roomId;
  }

  get userId() {
    return this.#userId;
  }

  get interval() {
    return this.#intervalMs;
  }

  get convexUrl() {
    return this.#convexUrl ?? this.#client.client.url;
  }

  get current() {
    return this.#state;
  }

  #reset() {
    this.#stopHeartbeat();

    void this.#disconnect();

    this.#sessionId = createUuidInAnyContext();

    void this.#heartbeat();

    this.#startHeartbeat();
  }

  #startHeartbeat() {
    this.#stopHeartbeat();

    this.#interval = setInterval(() => {
      void this.#heartbeat();
    }, this.interval);
  }

  #stopHeartbeat() {
    if (this.#interval) {
      clearInterval(this.#interval);
      this.#interval = null;
    }
  }
}

/**
 * Wraps a function to single-flight invocations, using the latest args.
 *
 * Generates a function that behaves like the passed in function,
 * but only one execution runs at a time. If multiple calls are requested
 * before the current call has finished, it will use the latest arguments
 * for the next invocation.
 *
 * Note: some requests may never be made. If while a request is in-flight, N
 * requests are made, N-1 of them will never resolve or reject the promise they
 * returned. For most applications this is the desired behavior, but if you need
 * all calls to eventually resolve, you can modify this code. Some behavior you
 * could add, left as an exercise to the reader:
 *   1. Resolve with the previous result when a request is about to be dropped.
 *   2. Resolve all N requests with the result of the next request.
 *   3. Do not return anything, and use this as a fire-and-forget library only.
 *
 * @param fn - Function to be called, with only one request in flight at a time.
 * This must be a stable identifier, e.g. returned from useCallback.
 * @returns Function that can be called whenever, returning a promise that will
 * only resolve or throw if the underlying function gets called.
 *
 * @see {@link https://github.com/get-convex/presence/blob/main/src/react/useSingleFlight.ts}
 */
export function singleFlight<F extends (...args: any[]) => Promise<any>>(fn: F): F {
  let inFlight = false;

  let upNext:
    | {
        args: Parameters<F>;
        resolve(value: Awaited<ReturnType<F>>): void;
        reject(reason: unknown): void;
      }
    | undefined;

  return (async (...args: Parameters<F>) => {
    if (inFlight) {
      return new Promise((resolve, reject) => {
        upNext = { args, resolve, reject };
      }) as ReturnType<F>;
    }

    inFlight = true;

    const first = fn(...args);

    try {
      return await first;
    } finally {
      while (upNext) {
        const current = upNext;
        upNext = undefined;

        try {
          current.resolve(await fn(...current.args));
        } catch (err) {
          current.reject(err);
        }
      }

      inFlight = false;
    }
  }) as F;
}
