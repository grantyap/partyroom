<script lang="ts">
	import AppHeader from "$lib/components/app-header.svelte";
	import type { LayoutProps } from "./$types";

	const { data, children }: LayoutProps = $props();
</script>

<div class="flex min-h-svh flex-col bg-background">
	<AppHeader user={data.user} />
	<main class="min-h-0 flex-1">
		{@render children()}
	</main>
</div>
