<script lang="ts">
	import { goto } from "$app/navigation";
	import { Button } from "$lib/components/ui/button";
	import * as Item from "$lib/components/ui/item";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import { useMutation, useQuery } from "convex-svelte";

	const rooms = useQuery(api.rooms.getRooms);

	const createRoom = useMutation(api.rooms.createRoom);
</script>

<Button
	onclick={async () => {
		const room = await createRoom({});
		await goto(`/app/rooms/${room.name}`);
	}}
>
	Create room
</Button>
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
