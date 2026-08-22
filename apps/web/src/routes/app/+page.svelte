<script lang="ts">
	import { goto } from "$app/navigation";
	import { Button } from "$lib/components/ui/button";
	import * as Item from "$lib/components/ui/item";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import { useMutation, useQuery } from "convex-svelte";

	const rooms = useQuery(api.rooms.getRooms);
	const recentRooms = useQuery(api.rooms.getRecentRooms);

	const createRoom = useMutation(api.rooms.createRoom);
</script>

<div class="mx-auto w-full max-w-4xl space-y-8 p-4 sm:p-6">
	<header class="flex items-center justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold">Rooms</h1>
			<p class="text-sm text-muted-foreground">Pick up where you left off or start a room.</p>
		</div>
		<Button
			onclick={async () => {
				const room = await createRoom({});
				await goto(`/app/rooms/${room.name}`);
			}}
		>
			Create room
		</Button>
	</header>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Your rooms</h2>
		{#if (rooms.data?.length ?? 0) === 0}
			<p class="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
				You haven't created a room yet.
			</p>
		{:else}
			<ul class="grid gap-3 sm:grid-cols-2">
				{#each rooms.data ?? [] as room (room._id)}
					<Item.Root variant="outline">
						{#snippet child({ props })}
							<a href="/app/rooms/{room.name}" {...props}>
								<Item.Header>
									<Item.Title>{room.name}</Item.Title>
									<p class="text-sm text-muted-foreground">Owned by you</p>
								</Item.Header>
							</a>
						{/snippet}
					</Item.Root>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Recent rooms</h2>
		{#if (recentRooms.data?.length ?? 0) === 0}
			<p class="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
				Rooms you visit from a shared link will appear here.
			</p>
		{:else}
			<ul class="grid gap-3 sm:grid-cols-2">
				{#each recentRooms.data ?? [] as room (room._id)}
					<Item.Root variant="outline">
						{#snippet child({ props })}
							<a href="/app/rooms/{room.name}" {...props}>
								<Item.Header>
									<Item.Title>{room.name}</Item.Title>
									<p class="text-sm text-muted-foreground">
										Hosted by {room.owner.name || "Unknown"}
									</p>
								</Item.Header>
								<p class="text-xs text-muted-foreground">
									Visited {new Date(room.lastVisitedAt).toLocaleString([], {
										dateStyle: "medium",
										timeStyle: "short",
									})}
								</p>
							</a>
						{/snippet}
					</Item.Root>
				{/each}
			</ul>
		{/if}
	</section>
</div>
