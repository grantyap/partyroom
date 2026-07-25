<script lang="ts">
	import * as Item from "$lib/components/ui/item";
	import { Presence } from "$lib/presence.svelte";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import { useQuery } from "convex-svelte";
	import type { PageProps } from "./$types";

	const { params, data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	const room = useQuery(
		api.rooms.getRoomByName,
		{ name: params.roomName },
		{ initialData: data.room },
	);

	const presence = new Presence({
		get roomId() {
			return data.room._id;
		},
		get userId() {
			return data.user._id;
		},
	});
</script>

<h1>Room &ldquo;{room.data?.name}&rdquo;</h1>
<pre class="text-xs text-muted-foreground font-mono">{JSON.stringify(
		room.data,
		null,
		2,
	)}</pre>
<h2>Users</h2>
<ul>
	{#each presence.current as presentUser (presentUser.userId)}
		<Item.Root>
			{#snippet child({ props })}
				<li {...props}>
					<Item.Header>
						<Item.Title>{presentUser.name}</Item.Title>
					</Item.Header>
					<pre class="text-xs text-muted-foreground font-mono">{JSON.stringify(
							presentUser,
							null,
							2,
						)}</pre>
				</li>
			{/snippet}
		</Item.Root>
	{/each}
</ul>
