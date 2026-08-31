import { tick } from "svelte";

const SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"]);
const AUTO_SCROLL_FALLBACK_TIMEOUT_MS = 2_000;

export type ScrollFollowOptions = {
  /** Returns the element whose `scrollTop` this class controls. */
  getViewport: () => HTMLElement | null;
  /**
   * Returns the `scrollTop` where the viewport should be kept, or `null` when
   * the consumer has not rendered a target yet.
   */
  getTargetScrollTop: () => number | null;
  /**
   * Optional check for lists that can resume following when the user reaches
   * a known position. Chat uses this to follow while the viewport is near the
   * bottom. Leave it unset when any user scroll should stop following, as with
   * the lyrics panel.
   */
  isAtFollowPosition?: (viewport: HTMLElement) => boolean;
  /** Return `false` while the consumer has no content that can be followed. */
  canFollow?: () => boolean;
};

/**
 * Keeps a scrollable list attached to a moving content target.
 *
 * Use this class whenever a component needs a scroll area to follow changing
 * content. The consumer supplies the target position: chat follows the
 * bottom of its list, while lyrics follows the centered active line. This
 * class handles the behavior that should be shared by both cases: follow
 * state, user-scroll detection, programmatic-scroll protection, and syncing.
 *
 * Create the instance inside the component that owns the scroll area. The
 * constructor registers cleanup with `$effect`, so callers do not need to
 * expose or call a separate `destroy()` method.
 */
export class ScrollFollow {
  /** True while automatic scrolling is enabled. */
  isFollowing = $state(true);

  #options: ScrollFollowOptions;
  #autoScrollTarget: number | null = null;
  #autoScrollBehavior: ScrollBehavior | null = null;
  #autoScrollViewport: HTMLElement | null = null;
  #autoScrollTimeout: number | undefined;

  constructor(options: ScrollFollowOptions) {
    this.#options = options;

    $effect(() => () => this.#clearAutoScroll());
  }

  #clearAutoScroll() {
    this.#autoScrollTarget = null;
    if (this.#autoScrollViewport !== null) {
      this.#autoScrollViewport.removeEventListener("scrollend", this.#handleScrollEnd);
      this.#autoScrollViewport = null;
    }
    this.#autoScrollBehavior = null;
    if (this.#autoScrollTimeout !== undefined) {
      window.clearTimeout(this.#autoScrollTimeout);
      this.#autoScrollTimeout = undefined;
    }
  }

  #canFollow() {
    return this.#options.canFollow?.() ?? true;
  }

  #handleScrollEnd = () => {
    this.#clearAutoScroll();
  };

  #setAutoScrollTarget(viewport: HTMLElement, target: number, behavior: ScrollBehavior) {
    this.#clearAutoScroll();
    this.#autoScrollTarget = target;
    this.#autoScrollBehavior = behavior;
    this.#autoScrollViewport = viewport;
    viewport.addEventListener("scrollend", this.#handleScrollEnd);
    if (this.#autoScrollTimeout !== undefined) {
      window.clearTimeout(this.#autoScrollTimeout);
    }
    this.#autoScrollTimeout = window.setTimeout(() => {
      this.#clearAutoScroll();
    }, AUTO_SCROLL_FALLBACK_TIMEOUT_MS);
  }

  #scrollToTarget(behavior: ScrollBehavior) {
    const viewport = this.#options.getViewport();
    const target = this.#options.getTargetScrollTop();
    if (!viewport || target === null || !Number.isFinite(target)) return;

    this.#setAutoScrollTarget(viewport, target, behavior);
    viewport.scrollTo({ top: target, behavior });
  }

  /**
   * Pass this to the scroll area's `onscroll` handler. It ignores scroll
   * events caused by `follow()` and otherwise updates `isFollowing` using
   * `isAtFollowPosition`, or stops following when no position check is given.
   */
  onScroll = () => {
    const viewport = this.#options.getViewport();
    if (!viewport) return;

    if (this.#autoScrollTarget !== null) {
      if (
        this.#autoScrollBehavior !== "smooth" &&
        Math.abs(viewport.scrollTop - this.#autoScrollTarget) <= 2
      ) {
        this.#clearAutoScroll();
      }
      return;
    }

    if (!this.#canFollow()) return;

    if (this.#options.isAtFollowPosition) {
      this.isFollowing = this.#options.isAtFollowPosition(viewport);
    } else {
      this.isFollowing = false;
    }
  };

  /**
   * Pass this to wheel, touch-move, or other handlers that mean the user is
   * intentionally scrolling. It stops automatic following immediately.
   */
  onUserScroll = () => {
    this.#clearAutoScroll();
    if (!this.#canFollow()) return;
    this.isFollowing = false;
  };

  /**
   * Use this when an interaction starts but should not yet stop following,
   * such as `touchstart` or `pointerdown` before movement occurs.
   */
  cancelAutoScroll = () => {
    this.#clearAutoScroll();
  };

  /** Pass this to `onkeydown` to treat keyboard scrolling as user scrolling. */
  onKeydown = (event: KeyboardEvent) => {
    if (SCROLL_KEYS.has(event.key)) this.onUserScroll();
  };

  /**
   * Follows the consumer's current target if `isFollowing` is still true.
   * Waits for Svelte to update the DOM first, so targets based on newly
   * rendered content are measured correctly. Call this after content changes.
   */
  async follow(behavior: ScrollBehavior = "smooth") {
    if (!this.isFollowing || !this.#canFollow()) return;
    await tick();
    if (!this.isFollowing || !this.#canFollow()) return;
    this.#scrollToTarget(behavior);
  }

  /** Re-enables following and scrolls to the current target. */
  async sync(behavior: ScrollBehavior = "smooth") {
    this.isFollowing = true;
    await this.follow(behavior);
  }

  /**
   * Re-enables following and cancels any old programmatic-scroll guard.
   * Call this when the identity of the followed content changes.
   */
  reset() {
    this.#clearAutoScroll();
    this.isFollowing = true;
  }
}
