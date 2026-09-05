<!--
@component
Displays one sortable queue item using data and permissions from `Playback.Root`.

Use this inside `Playback.QueueList`. The default view shows the title, status,
duration, processing progress, and remove button. Add a `children` snippet to
replace that content while keeping the sortable item shell.

@see `Playback.QueueList` for the drag-and-drop provider.

@example
```svelte
<Playback.QueueList>
  {#snippet children({ items })}
    <ul>
      {#each items as item, index (item._id)}
        <Playback.QueueItem {item} {index}>
          {#snippet children({ title })}<span>{title}</span>{/snippet}
        </Playback.QueueItem>
      {/each}
    </ul>
  {/snippet}
</Playback.QueueList>
```
-->
<script lang="ts" module>
	import type { Playback, RoomMediaItem } from "../../types";

	export type QueueItemData = Playback["queue"][number];
	export type QueueItemRenderProps = {
		item: QueueItemData;
		media?: RoomMediaItem;
		title: string;
		duration?: number;
		canRemove: boolean;
		remove: () => void;
	};
</script>

<script lang="ts">
	import {
		Avatar,
		AvatarFallback,
		AvatarImage,
	} from "$lib/components/ui/avatar";
	import { Button } from "$lib/components/ui/button";
	import { Trash2 } from "@lucide/svelte";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import { useMutation } from "convex-svelte";
	import type { Snippet } from "svelte";
	import { formatDuration } from "../../media-format";
	import MediaProgressPopover from "../../media/media-progress-popover.svelte";
	import { usePlayback } from "../context.svelte";
	import SortableQueueItem from "./sortable-queue-item.svelte";

	let {
		item,
		index,
		children,
	}: {
		item: QueueItemData;
		index: number;
		children?: Snippet<[QueueItemRenderProps]>;
	} = $props();

	const playbackContext = usePlayback();
	const removeItem = useMutation(api.playback.remove);

	const media = $derived(playbackContext.mediaById.get(item.roomMedia));
	const title = $derived(
		item.kind === "ready"
			? item.title
			: (media?.title ??
					(item.kind === "failed" ? "Unavailable media" : "Processing media…")),
	);
	const duration = $derived(
		item.kind === "ready"
			? (item.durationSeconds ?? undefined)
			: media?.duration,
	);
	const canRemove = $derived(
		playbackContext.playback?.permissions.removeFromQueue ?? false,
	);

	function remove() {
		void removeItem({
			roomId: playbackContext.roomId,
			queueItemKey: item._id,
		});
	}

	const renderProps: QueueItemRenderProps = $derived({
		item,
		media,
		title,
		duration,
		canRemove,
		remove,
	});
</script>

<SortableQueueItem
	id={item._id}
	{index}
	label={title}
	disabled={!playbackContext.playback?.permissions.reorderQueue}
>
	{#if children}
		{@render children(renderProps)}
	{:else}
		<div class="min-w-0 flex-1 space-y-1.5">
			<p class="line-clamp-2 text-sm leading-snug font-medium wrap-anywhere" {title}>{title}</p>
			<div class="flex min-w-0 items-center gap-1.5 text-[0.65rem] text-muted-foreground">
				<Avatar userId={item.addedBy._id} class="size-4 border-0">
					{#if item.addedBy.image}<AvatarImage src={item.addedBy.image} alt="" />{/if}
					<AvatarFallback class="text-[0.5rem]">{item.addedBy.name.slice(0, 1).toUpperCase()}</AvatarFallback>
				</Avatar>
				<span class="truncate">{item.addedBy.name}</span>
				{#if formatDuration(duration)}<span aria-hidden="true">·</span><span class="shrink-0 tabular-nums">{formatDuration(duration)}</span>{/if}
				{#if item.availability !== "ready"}
					<span class="shrink-0" class:text-destructive={item.availability === "failed"}>· {item.availability === "processing" ? "Processing…" : "Unavailable"}</span>
				{/if}
			</div>
		</div>
		{#if item.availability === "processing" && media}
			<MediaProgressPopover
				title={media.title ?? "Resolving media…"}
				steps={media.steps}
			/>
		{/if}
		{#if canRemove}
			<Button
				variant="ghost"
				size="icon"
				class="size-10 shrink-0 rounded-lg text-muted-foreground hover:text-destructive"
				aria-label={`Remove ${title} from queue`}
				onclick={remove}
			>
				<Trash2 />
			</Button>
		{/if}
	{/if}
</SortableQueueItem>
