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
	{#if playbackContext.playback?.permissions.addToQueue}
		<RoomTabs.Header class="border-b p-3">
			<QueueForm />
		</RoomTabs.Header>
	{/if}

	<RoomTabs.ScrollArea>
		<QueueList />
	</RoomTabs.ScrollArea>
</div>
