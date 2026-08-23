<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
	import { useAction, useMutation, useQuery } from "convex-svelte";
	import { onMount } from "svelte";
	import RoomMediaItem from "./room-media-item.svelte";

	let { roomId }: { roomId: Id<"rooms"> } = $props();

	const roomMedia = useQuery(api.media.jobs.listRoomMedia, () => ({ roomId }));
	const requestMedia = useAction(api.media.actions.requestMedia);
	const reprocessMedia = useMutation(api.media.jobs.reprocess);
	const removeMedia = useMutation(api.media.jobs.removeFromRoom);

	let sourceUrl = $state("");
	let submitting = $state(false);
	let reprocessingMediaId = $state<Id<"roomMedia"> | null>(null);
	let removingMediaId = $state<Id<"roomMedia"> | null>(null);
	let error = $state<string | null>(null);
	let currentTime = $state(Date.now());

	onMount(() => {
		const timer = window.setInterval(() => {
			currentTime = Date.now();
		}, 1_000);
		return () => window.clearInterval(timer);
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!sourceUrl.trim() || submitting) return;
		submitting = true;
		error = null;
		try {
			await requestMedia({ roomId, url: sourceUrl.trim() });
			sourceUrl = "";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Unable to queue media";
		} finally {
			submitting = false;
		}
	}

	async function reprocess(roomMediaId: Id<"roomMedia">) {
		if (reprocessingMediaId) return;
		reprocessingMediaId = roomMediaId;
		error = null;
		try {
			await reprocessMedia({ roomId, roomMediaId });
		} catch (cause) {
			error =
				cause instanceof Error ? cause.message : "Unable to reprocess media";
		} finally {
			reprocessingMediaId = null;
		}
	}

	async function remove(roomMediaId: Id<"roomMedia">) {
		if (removingMediaId) return;
		removingMediaId = roomMediaId;
		error = null;
		try {
			await removeMedia({ roomId, roomMediaId });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Unable to delete media";
		} finally {
			removingMediaId = null;
		}
	}
</script>

<section class="space-y-4">
	<div>
		<h2 class="font-heading text-xl font-medium">Media</h2>
		<p class="text-sm text-muted-foreground">
			Paste a video URL to prepare a vocal-free version for this room.
		</p>
	</div>

	<form class="flex items-center gap-2" onsubmit={submit}>
		<Input
			type="url"
			placeholder="https://…"
			aria-label="Media URL"
			bind:value={sourceUrl}
			disabled={submitting}
			class="flex-1"
		/>
		<Button type="submit" disabled={submitting || !sourceUrl.trim()}>
			{submitting ? "Queuing…" : "Add media"}
		</Button>
	</form>
	{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}

	{#if roomMedia.isLoading}
		<p class="text-sm text-muted-foreground">Loading room media…</p>
	{:else if roomMedia.error}
		<p class="text-sm text-destructive" role="alert">Unable to load room media.</p>
	{:else if roomMedia.data?.length === 0}
		<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
			No media has been added yet.
		</p>
	{:else}
		<ul class="space-y-4">
			{#each roomMedia.data ?? [] as media (media._id)}
				<RoomMediaItem
					{media}
					{currentTime}
					{reprocessingMediaId}
					{removingMediaId}
					onReprocess={(id) => void reprocess(id)}
					onRemove={(id) => void remove(id)}
				/>
			{/each}
		</ul>
	{/if}
</section>
