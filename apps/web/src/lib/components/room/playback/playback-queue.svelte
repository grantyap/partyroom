<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { GripVertical, Plus, Trash2 } from "@lucide/svelte";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
	import { useAction, useMutation } from "convex-svelte";
	import MediaProgressPopover from "../media/media-progress-popover.svelte";
	import { formatDuration } from "../media-format";
	import { usePlayback } from "./context.svelte";

	const playbackContext = usePlayback();
	const roomId = $derived(playbackContext.roomId);
	const playback = $derived(playbackContext.playback);
	const mediaById = $derived(playbackContext.mediaById);
	const canAdd = $derived(playback?.permissions.addToQueue ?? false);

	const requestMedia = useAction(api.media.actions.requestMedia);
	const remove = useMutation(api.playback.remove);
	const reorder = useMutation(api.playback.reorder);

	let sourceUrl = $state("");
	let submitting = $state(false);
	let error = $state<string | null>(null);
	let draggedItem = $state<Id<"roomQueueItems"> | null>(null);

	async function addSong(event: SubmitEvent) {
		event.preventDefault();
		if (!sourceUrl.trim() || submitting) return;
		submitting = true;
		error = null;
		try {
			await requestMedia({ roomId, url: sourceUrl.trim() });
			sourceUrl = "";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Unable to add song";
		} finally {
			submitting = false;
		}
	}

	async function dropBefore(targetId: Id<"roomQueueItems"> | null) {
		const queue = playback?.queue ?? [];
		const moving = draggedItem;
		draggedItem = null;
		if (!moving || moving === targetId) return;
		const withoutMoving = queue.filter(({ _id }) => _id !== moving);
		const index =
			targetId === null
				? withoutMoving.length
				: withoutMoving.findIndex(({ _id }) => _id === targetId);
		if (index < 0) return;
		try {
			await reorder({
				roomId,
				queueItemId: moving,
				afterItemId: index > 0 ? withoutMoving[index - 1]._id : null,
				beforeItemId:
					index < withoutMoving.length ? withoutMoving[index]._id : null,
			});
		} catch (cause) {
			error =
				cause instanceof Error ? cause.message : "Unable to reorder queue";
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col" data-slot="playback-queue">
	{#if canAdd || error}
		<div class="border-b p-3">
			{#if canAdd}
			<form class="flex gap-2" onsubmit={addSong}>
				<Input type="url" placeholder="Paste video URL" aria-label="Video URL" bind:value={sourceUrl} disabled={submitting} />
				<Button size="icon" type="submit" disabled={submitting || !sourceUrl.trim()} aria-label="Add song"><Plus /></Button>
			</form>
			{/if}
			{#if error}<p class="mt-2 text-xs text-destructive" role="alert">{error}</p>{/if}
		</div>
	{/if}

	<ul class="min-h-24 flex-1 space-y-2 overflow-y-auto p-3">
		{#each playback?.queue ?? [] as item (item._id)}
			{@const media = mediaById.get(item.roomMedia)}
			<li
				draggable={playback?.permissions.reorderQueue ?? false}
				ondragstart={() => (draggedItem = item._id)}
				ondragend={() => (draggedItem = null)}
				ondragover={(event) => { if (draggedItem) event.preventDefault(); }}
				ondrop={(event) => { event.preventDefault(); void dropBefore(item._id); }}
				class="group flex items-center gap-2 rounded-lg border bg-background p-2"
				class:opacity-50={draggedItem === item._id}
			>
				{#if playback?.permissions.reorderQueue}
					<GripVertical class="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
				{/if}
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium">{media?.title ?? "Resolving media…"}</p>
					<p class="text-xs text-muted-foreground">
						{item.availability === "ready" ? "Ready" : item.availability === "processing" ? "Processing…" : "Unavailable"}
						{#if formatDuration(media?.duration)} · {formatDuration(media?.duration)}{/if}
					</p>
				</div>
				{#if item.availability === "processing" && media}
					<MediaProgressPopover title={media.title ?? "Resolving media…"} steps={media.steps} />
				{/if}
				{#if playback?.permissions.removeFromQueue}
					<Button variant="ghost" size="icon-sm" aria-label={`Remove ${media?.title ?? "song"} from queue`} onclick={() => void remove({ roomId, queueItemId: item._id })}>
						<Trash2 />
					</Button>
				{/if}
			</li>
		{/each}
		{#if (playback?.queue.length ?? 0) === 0}
			<li class="p-5 text-center text-sm text-muted-foreground">Nothing queued yet.</li>
		{/if}
		{#if draggedItem}
			<li class="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground" ondragover={(event) => event.preventDefault()} ondrop={(event) => { event.preventDefault(); void dropBefore(null); }}>
				Drop at end
			</li>
		{/if}
	</ul>
</div>
