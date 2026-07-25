<script lang="ts">
	import Header from "$lib/components/header.svelte";
	import type { LayoutProps } from "./$types";

	const { children }: LayoutProps = $props();
</script>

<div class="grid h-svh grid-rows-[auto_1fr] bg-neutral-950 text-neutral-100">
	<Header />
	<main class="overflow-y-auto">
		{@render children()}
	</main>
</div>
