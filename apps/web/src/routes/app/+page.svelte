<script lang="ts">
	import { goto } from "$app/navigation";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import * as Item from "$lib/components/ui/item";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import { useMutation, useQuery } from "convex-svelte";
	import type { PageProps } from "./$types";

	const { data }: PageProps = $props();
	const isGuest = $derived(
		data.user != null &&
		"isAnonymous" in data.user &&
		data.user.isAnonymous === true,
	);

	const rooms = useQuery(api.rooms.getRooms);
	const recentRooms = useQuery(api.rooms.getRecentRooms);

	const createRoom = useMutation(api.rooms.createRoom);
</script>

<div class="mx-auto w-full max-w-4xl space-y-8 p-4 sm:p-6">
	<header class="flex items-center justify-between gap-4">
		<div>
			<h1 class="font-heading text-2xl font-semibold">Rooms</h1>
			<p class="text-sm text-muted-foreground">
				{isGuest
					? "You're visiting as a guest."
					: "Pick up where you left off or start a room."}
			</p>
		</div>
		{#if !isGuest}
			<Button
				onclick={async () => {
					const room = await createRoom({});
					await goto(`/app/rooms/${room.name}`);
				}}
			>
				Create room
			</Button>
		{/if}
	</header>

	<section class="space-y-3">
		<h2 class="font-heading text-lg font-semibold">Your rooms</h2>
		{#if (rooms.data?.length ?? 0) === 0}
			<Empty.Root class="border p-6">
				<Empty.Header>
					<Empty.Title class="text-base">No rooms yet</Empty.Title>
					<Empty.Description>
						{isGuest
							? "Create an account to start your own room."
							: "You haven't created a room yet."}
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
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
		<h2 class="font-heading text-lg font-semibold">
			{isGuest ? "Joined rooms" : "Recent rooms"}
		</h2>
		{#if (recentRooms.data?.length ?? 0) === 0}
			<Empty.Root class="border p-6">
				<Empty.Header>
					<Empty.Title class="text-base">
						{isGuest ? "No joined rooms" : "No recent rooms"}
					</Empty.Title>
					<Empty.Description>
						Rooms you visit from a shared link will appear here.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
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
