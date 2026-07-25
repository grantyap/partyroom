<script lang="ts">
	import { useQuery } from "@mmailaender/convex-svelte";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import * as Item from "$lib/components/ui/item";

	const rooms = useQuery(api.rooms.getRooms);
</script>

<ul>
	{#each rooms.data as room (room._id)}
		<Item.Root variant="outline">
			{#snippet child({ props })}
				<a href="/app/rooms/{room.name}" {...props}>
					<Item.Header>
						<Item.Title>{room.name}</Item.Title>
						<p class="text-sm text-muted-foreground">
							{room.owner.name || "Unknown"}
						</p>
					</Item.Header>
					<p>{JSON.stringify(room)}</p>
				</a>
			{/snippet}
		</Item.Root>
	{/each}
</ul>
