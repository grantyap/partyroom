<script lang="ts">
	import { page } from "$app/state";
	import ErrorState from "$lib/components/error-state.svelte";
</script>

<svelte:head>
	<title>Something went wrong · Partyroom</title>
</svelte:head>

<ErrorState fullPage status={page.status} message={page.error?.message} />
