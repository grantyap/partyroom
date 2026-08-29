<script lang="ts">
	import * as RoomTabs from "$lib/components/room/tabs";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { DragDropProvider, type DragDropEvents } from "@dnd-kit-svelte/svelte";
	import { isSortable } from "@dnd-kit-svelte/svelte/sortable";
	import { Plus, Trash2 } from "@lucide/svelte";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import { useAction, useMutation } from "convex-svelte";
	import MediaProgressPopover from "../media/media-progress-popover.svelte";
	import { formatDuration } from "../media-format";
	import { usePlayback } from "./context.svelte";
	import SortableQueueItem from "./sortable-queue-item.svelte";

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

	async function handleDragEnd(
		event: Parameters<DragDropEvents["dragend"]>[0],
	) {
		if (event.canceled || !isSortable(event.operation.source)) return;

		const queue = playback?.queue ?? [];
		const moving = String(event.operation.source.id);
		const targetIndex = event.operation.source.sortable.index;
		const initialIndex = event.operation.source.sortable.initialIndex;
		if (targetIndex === initialIndex) return;

		const withoutMoving = queue.filter(({ _id }) => _id !== moving);
		if (withoutMoving.length === queue.length) return;
		const index = Math.min(targetIndex, withoutMoving.length);
		error = null;
		try {
			await reorder({
				roomId,
				queueItemKey: moving,
				afterItemKey: index > 0 ? withoutMoving[index - 1]._id : null,
				beforeItemKey:
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
		<RoomTabs.Header class="border-b p-3">
			{#if canAdd}
				<form class="flex gap-2" onsubmit={addSong}>
					<Input type="url" placeholder="Paste video URL" aria-label="Video URL" bind:value={sourceUrl} disabled={submitting} />
					<Button size="icon" type="submit" disabled={submitting || !sourceUrl.trim()} aria-label="Add song"><Plus /></Button>
				</form>
			{/if}
			{#if error}<p class="mt-2 text-xs text-destructive" role="alert">{error}</p>{/if}
		</RoomTabs.Header>
	{/if}

	<RoomTabs.ScrollArea>
		<DragDropProvider onDragEnd={(event) => void handleDragEnd(event)}>
			<ul class="min-h-24 space-y-2 p-3">
				{#each playback?.queue ?? [] as item, index (item._id)}
					{@const media = mediaById.get(item.roomMedia)}
					{@const title = item.kind === "ready" ? item.title : media?.title ?? (item.kind === "failed" ? "Unavailable media" : "Processing media…")}
					{@const duration = item.kind === "ready" ? item.durationSeconds ?? undefined : media?.duration}
					<SortableQueueItem
						id={item._id}
						{index}
						label={title}
						disabled={!playback?.permissions.reorderQueue}
					>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium">{title}</p>
							<p class="text-xs text-muted-foreground">
								{item.availability === "ready" ? "Ready" : item.availability === "processing" ? "Processing…" : "Unavailable"}
								{#if formatDuration(duration)} · {formatDuration(duration)}{/if}
							</p>
						</div>
						{#if item.availability === "processing" && media}
							<MediaProgressPopover title={media.title ?? "Resolving media…"} steps={media.steps} />
						{/if}
						{#if playback?.permissions.removeFromQueue}
							<Button variant="ghost" size="icon-sm" aria-label={`Remove ${title} from queue`} onclick={() => void remove({ roomId, queueItemKey: item._id })}>
								<Trash2 />
							</Button>
						{/if}
					</SortableQueueItem>
				{/each}
				{#if (playback?.queue.length ?? 0) === 0}
					<li class="p-5 text-center text-sm text-muted-foreground">Nothing queued yet.</li>
				{/if}
			</ul>
		</DragDropProvider>
	</RoomTabs.ScrollArea>
</div>
