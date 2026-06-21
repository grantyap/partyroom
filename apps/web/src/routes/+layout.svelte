<script lang="ts">
	import { authClient } from "$lib/auth-client";
	import { createSvelteAuthClient } from "@mmailaender/convex-better-auth-svelte/svelte";
	import "../app.css";
	import type { LayoutProps } from "./$types";

	const { data, children }: LayoutProps = $props();

	createSvelteAuthClient({ authClient, getServerState: () => data.authState });
</script>

{@render children()}
