<script lang="ts">
	import { SearchParams } from "#lib/hooks/search-params.svelte.js";
	import CrownIcon from "@lucide/svelte/icons/crown";
	import { goto } from "$app/navigation";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Empty from "#lib/components/ui/empty/index.js";
	import * as Item from "#lib/components/ui/item/index.js";
	import { api } from "@partyroom/backend/convex/_generated/api.js";
	import { useMutation, useQuery } from "convex-svelte";

	const query = new SearchParams({ billing: null });
	const user = useQuery(api.auth.getCurrentUser);
	const rooms = useQuery(api.rooms.getRooms);
	const recentRooms = useQuery(api.rooms.getRecentRooms);

	const billing = useQuery(api.billing.status);
	const createRoom = useMutation(api.rooms.createRoom);
	let creating = $state(false);
	let createError = $state<string | null>(null);

	async function create() {
		if (creating) return;
		if (!user.data?.emailVerified || !billing.data?.premium) {
			await query.update({ billing: "" });
			return;
		}
		creating = true;
		createError = null;
		try {
			const room = await createRoom({});
			await goto(`/app/rooms/${room.name}`);
		} catch (cause) {
			if (cause instanceof Error && cause.message.includes("Premium subscription required")) {
				await query.update({ billing: "" });
			} else {
				createError = "We couldn’t create your room. Please try again.";
			}
		} finally {
			creating = false;
		}
	}
</script>

<div class="mx-auto w-full max-w-4xl space-y-8 p-4 sm:p-6">
	<header class="flex items-center justify-between gap-4">
		<div>
			<h1 class="font-heading text-2xl font-semibold">Rooms</h1>
			<p class="text-sm text-muted-foreground">Pick up where you left off or start a room.</p>
		</div>
		<Button disabled={creating || !billing.data || !user.data} onclick={create}>
			{#if billing.data && !billing.data.premium}<CrownIcon class="size-4 text-amber-500" aria-hidden="true" />{/if}
			{creating ? "Creating…" : "Create room"}
			{#if billing.data && !billing.data.premium}<span class="sr-only"> — requires Premium{!user.data?.emailVerified ? " and email verification" : ""}</span>{/if}
		</Button>
	</header>

	{#if createError}<p class="text-sm text-destructive" role="alert">{createError}</p>{/if}

	<section class="space-y-3">
		<h2 class="font-heading text-lg font-semibold">Your rooms</h2>
		{#if (rooms.data?.length ?? 0) === 0}
			<Empty.Root class="border p-6">
				<Empty.Header>
					<Empty.Title class="text-base">No rooms yet</Empty.Title>
					<Empty.Description>You haven't created a room yet.</Empty.Description>
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
		<h2 class="font-heading text-lg font-semibold">Recent rooms</h2>
		{#if (recentRooms.data?.length ?? 0) === 0}
			<Empty.Root class="border p-6">
				<Empty.Header>
					<Empty.Title class="text-base">No recent rooms</Empty.Title>
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
