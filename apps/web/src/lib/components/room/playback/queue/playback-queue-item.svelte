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
	import type { RoomMediaItem, Playback } from "../../types";

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
	import { Button } from "$lib/components/ui/button";
	import { Trash2 } from "@lucide/svelte";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import { useMutation } from "convex-svelte";
	import type { Snippet } from "svelte";
	import MediaProgressPopover from "../../media/media-progress-popover.svelte";
	import { formatDuration } from "../../media-format";
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
		item.kind === "ready" ? (item.durationSeconds ?? undefined) : media?.duration,
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
		<div class="min-w-0 flex-1">
			<p class="text-sm font-medium">{title}</p>
			<p class="text-xs text-muted-foreground">
				{item.availability === "ready"
					? "Ready"
					: item.availability === "processing"
						? "Processing…"
						: "Unavailable"}
				{#if formatDuration(duration)} · {formatDuration(duration)}{/if}
			</p>
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
				size="icon-sm"
				aria-label={`Remove ${title} from queue`}
				onclick={remove}
			>
				<Trash2 />
			</Button>
		{/if}
	{/if}
</SortableQueueItem>
