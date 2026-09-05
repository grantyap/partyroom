<!--
@component
Provides drag-and-drop behavior and displays the current playback queue.

Use the default sortable list or add a `children` snippet to control the list
markup. Custom queue items should use `Playback.QueueItem` so reordering keeps
working.

@see `Playback.QueueItem` for one sortable item.
@see `Playback.QueueEmpty` for the empty state.

@example
```svelte
<Playback.QueueList>
  {#snippet children({ items })}
    <ol>
      {#each items as item, index (item._id)}
        <Playback.QueueItem {item} {index} />
      {/each}
      <Playback.QueueEmpty><li>No songs yet.</li></Playback.QueueEmpty>
    </ol>
  {/snippet}
</Playback.QueueList>
```
-->
<script lang="ts" module>
	import type { Playback } from "../../types";

	export type QueueListRenderProps = {
		items: Playback["queue"];
		error: string | null;
	};
</script>

<script lang="ts">
	import { cn } from "$lib/utils";
	import { DragDropProvider, type DragDropEvents } from "@dnd-kit-svelte/svelte";
	import { isSortable } from "@dnd-kit-svelte/svelte/sortable";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import { useMutation } from "convex-svelte";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { usePlayback } from "../context.svelte";
	import QueueEmpty from "./playback-queue-empty.svelte";
	import QueueItem from "./playback-queue-item.svelte";

	let {
		children,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLUListElement> & {
		children?: Snippet<[QueueListRenderProps]>;
	} = $props();

	const playbackContext = usePlayback();
	const reorder = useMutation(api.playback.reorder);
	let error = $state<string | null>(null);

	async function handleDragEnd(
		event: Parameters<DragDropEvents["dragend"]>[0],
	) {
		if (event.canceled || !isSortable(event.operation.source)) return;

		const queue = playbackContext.playback?.queue ?? [];
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
				roomId: playbackContext.roomId,
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

<DragDropProvider onDragEnd={(event) => void handleDragEnd(event)}>
	{#if children}
		{@render children({
			items: playbackContext.playback?.queue ?? [],
			error,
		})}
	{:else}
		{#if error}
			<p class="px-3 pt-3 text-xs text-destructive" role="alert">{error}</p>
		{/if}
		<ul
			data-slot="playback-queue-list"
			class={cn("min-h-24 divide-y divide-border/60 px-2 pb-2", className)}
			{...restProps}
		>
			{#each playbackContext.playback?.queue ?? [] as item, index (item._id)}
				<QueueItem {item} {index} />
			{/each}
			<QueueEmpty />
		</ul>
	{/if}
</DragDropProvider>
