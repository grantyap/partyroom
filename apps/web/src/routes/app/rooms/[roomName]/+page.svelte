<script lang="ts">
	import { useQuery } from "@mmailaender/convex-svelte";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import type { PageProps } from "./$types";

	const { params, data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	const room = useQuery(
		api.rooms.getRoomByName,
		{ name: params.roomName },
		{ initialData: data.room },
	);
</script>

<pre class="text-xs text-muted-foreground font-mono">{JSON.stringify(
		room.data,
		null,
		2,
	)}</pre>
