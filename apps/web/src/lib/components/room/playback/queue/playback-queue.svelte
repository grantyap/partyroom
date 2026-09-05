<!--
@component
Displays the complete default queue using data from `Playback.Root`.

Use this when the standard add form and sortable list are enough. For a custom
layout, compose `Playback.QueueForm`, `Playback.QueueList`,
`Playback.QueueItem`, and `Playback.QueueEmpty` instead.

@see `Playback.QueueForm` for the add-song form.
@see `Playback.QueueList` for the sortable list.

@example
```svelte
<Playback.Root {roomId}>
  <Playback.Queue />
</Playback.Root>
```
-->
<script lang="ts">
	import * as RoomTabs from "$lib/components/room/tabs";
	import { usePlayback } from "../context.svelte";
	import QueueForm from "./playback-queue-form.svelte";
	import QueueList from "./playback-queue-list.svelte";

	const playbackContext = usePlayback();
</script>

<div class="flex h-full min-h-0 flex-col" data-slot="playback-queue">
	<div class="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
		<h2 class="font-heading text-[0.65rem] font-semibold tracking-widest text-muted-foreground uppercase">Up next</h2>
		<p class="text-[0.65rem] text-muted-foreground">Played in order</p>
	</div>
	<RoomTabs.ScrollArea><QueueList /></RoomTabs.ScrollArea>
	{#if playbackContext.playback?.permissions.addToQueue}
		<RoomTabs.Footer class="border-t bg-muted/20 p-3 sm:p-4">
			<QueueForm />
		</RoomTabs.Footer>
	{:else}
		<RoomTabs.Footer class="border-t px-4 py-3 text-xs text-muted-foreground">
			The host is choosing the music for this room.
		</RoomTabs.Footer>
	{/if}
</div>
