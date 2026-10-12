<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "#lib/utils.js";

  let { id, children, highlight, class: className, ...props }: HTMLAttributes<HTMLDivElement> & {
    id: string;
    children?: Snippet;
    highlight?: Snippet;
  } = $props();
  let layer = $state<HTMLDivElement | null>(null);
  onMount(() => {
    let animation: Animation | undefined;

    function matches(hash: string) {
      try {
        return decodeURIComponent(hash.slice(1)) === id;
      } catch {
        return false;
      }
    }

    function highlight() {
      animation?.cancel();
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      animation = layer?.animate(
        [{ opacity: 1 }, { opacity: reducedMotion ? 1 : 0 }],
        { duration: reducedMotion ? 1000 : 1200, easing: "ease-out" },
      );
    }

    function highlightHash() {
      if (matches(window.location.hash)) highlight();
    }

    function highlightLink(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.download ||
        (link.target && link.target !== "_self")
      )
        return;
      const url = new URL(link.href);
      if (
        url.origin === window.location.origin &&
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        matches(url.hash)
      )
        highlight();
    }

    highlightHash();
    window.addEventListener("hashchange", highlightHash);
    document.addEventListener("click", highlightLink);
    return () => {
      animation?.cancel();
      window.removeEventListener("hashchange", highlightHash);
      document.removeEventListener("click", highlightLink);
    };
  });
</script>

<div {id} class={cn("relative isolate", className)} {...props}>
  <div bind:this={layer} aria-hidden="true" class="pointer-events-none absolute inset-0 -z-10 opacity-0">
    {#if highlight}
      {@render highlight()}
    {:else}
      <div class="absolute -inset-2 rounded-xl bg-primary/10"></div>
    {/if}
  </div>
  {@render children?.()}
</div>
