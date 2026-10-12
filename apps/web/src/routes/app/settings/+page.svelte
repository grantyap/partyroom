<script lang="ts">
  import { onMount } from "svelte";
  import AnchorHighlight from "#lib/components/anchor-highlight.svelte";
  import PremiumPanel from "#lib/components/premium-panel.svelte";
  import type { PageProps } from "./$types";
  let { data }: PageProps = $props();
  const sections = [
    { id: "account", label: "Account" },
    { id: "email", label: "Email verification" },
    { id: "billing", label: "Billing" },
  ];
  let active = $state("account");
  let content = $state<HTMLDivElement | null>(null);
  let navigation = $state<HTMLElement | null>(null);

  onMount(() => {
    function updateActive() {
      if (!content || !navigation) return;
      if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
        active = sections[sections.length - 1].id;
        return;
      }
      const threshold = window.matchMedia("(min-width: 768px)").matches ? 48 : navigation.getBoundingClientRect().bottom + 24;
      active = sections.findLast(({ id }) => {
        const element = content?.querySelector(`#${id}`);
        return element && element.getBoundingClientRect().top <= threshold;
      })?.id ?? "account";
    }
    function updateHash() {
      const id = window.location.hash.slice(1);
      if (sections.some((section) => section.id === id)) active = id;
      else updateActive();
    }
    const observer = new ResizeObserver(() => {
      updateActive();
      if (document.documentElement.scrollHeight <= window.innerHeight) updateHash();
    });
    if (content) observer.observe(content);
    window.addEventListener("scroll", updateActive, { passive: true });
    window.addEventListener("resize", updateActive);
    window.addEventListener("hashchange", updateHash);
    updateHash();
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", updateHash);
      window.removeEventListener("scroll", updateActive);
      window.removeEventListener("resize", updateActive);
    };
  });
</script>

<svelte:head><title>Settings · Partyroom</title></svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
  <header class="mb-8 space-y-2">
    <a href="/app" class="text-sm text-muted-foreground underline underline-offset-4">Back to Rooms</a>
    <h1 class="pt-3 font-heading text-3xl font-semibold">Settings</h1>
  </header>
  <div class="grid items-start gap-8 md:grid-cols-[12rem_1fr] md:gap-12">
    <nav bind:this={navigation} aria-label="Settings sections" class="sticky top-0 z-10 border-b bg-background py-3 md:top-8 md:border-b-0 md:border-r md:py-0 md:pr-6">
      <ul class="flex flex-wrap md:flex-col">
        {#each sections as section}
          <li class={section.id === "account" ? "w-full" : ""}>
            <a href={`#${section.id}`} onclick={() => active = section.id} aria-current={active === section.id ? "location" : undefined} class={`block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted ${section.id === "account" ? "font-semibold" : "md:pl-6"} ${active === section.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>{section.label}</a>
          </li>
        {/each}
      </ul>
    </nav>
    <div bind:this={content} class="min-w-0">
      <AnchorHighlight id="account" class="scroll-mt-32 md:scroll-mt-8">
        <section aria-labelledby="account-heading">
          <header class="space-y-2 border-b pb-6">
            <h2 id="account-heading" class="text-xl font-semibold">Account</h2>
            <p class="text-sm text-muted-foreground">{data.user?.name}</p>
          </header>
          <PremiumPanel settingsPage />
        </section>
      </AnchorHighlight>
    </div>
  </div>
</div>
