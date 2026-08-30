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
	import TextScroller from "$lib/components/text-scroller/text-scroller.svelte";
	import {
		Avatar,
		AvatarFallback,
		AvatarImage,
	} from "$lib/components/ui/avatar";
	import { Button } from "$lib/components/ui/button";
	import * as Tooltip from "$lib/components/ui/tooltip";
	import { getMemberColors } from "$lib/member-colors";
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
	const addedByColors = $derived(getMemberColors(item.addedBy._id));

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
		<Tooltip.Provider>
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Avatar
						size="sm"
						class="border-2"
						style={`border-color: ${addedByColors.accent}`}
					>
						{#if item.addedBy.image}
							<AvatarImage src={item.addedBy.image} alt="" />
						{/if}
						<AvatarFallback
							style={`background-color: ${addedByColors.fill}; color: ${addedByColors.foreground}`}
							class="font-semibold"
						>
							{item.addedBy.name.slice(0, 1).toUpperCase()}
						</AvatarFallback>
					</Avatar>
				</Tooltip.Trigger>
				<Tooltip.Content>{item.addedBy.name}</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
		<div class="min-w-0 flex-1">
			<TextScroller {title} class="text-sm font-medium">
				{title}
			</TextScroller>
			<p class="text-xs text-muted-foreground">
				{item.availability === "ready"
					? "Ready"
					: item.availability === "processing"
						? "Processing…"
						: "Unavailable"}
				{#if formatDuration(duration)}
					· {formatDuration(duration)}{/if}
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
