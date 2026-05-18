<script lang="ts">
	import { authClient } from "$lib/auth-client";
	import { createSvelteAuthClient } from "@mmailaender/convex-better-auth-svelte/svelte";
	import "../app.css";
	import Header from "../components/Header.svelte";

	createSvelteAuthClient({ authClient });

	const { children } = $props();
</script>

<div class="grid h-svh grid-rows-[auto_1fr]">
	<Header />
	<main class="overflow-y-auto">
		{@render children()}
	</main>
</div>
