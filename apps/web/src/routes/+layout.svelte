<script lang="ts">
	import { authClient } from "$lib/auth-client";
	import {
		createSvelteAuthClient,
		type AuthClient,
	} from "@mmailaender/convex-better-auth-svelte/svelte";
	import "../app.css";
	import type { LayoutProps } from "./$types";

	const { data, children }: LayoutProps = $props();

	createSvelteAuthClient({
		authClient: authClient as unknown as AuthClient,
		getServerState: () => data.authState,
	});
</script>

{@render children()}
