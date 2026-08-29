<!--
@component
Displays an empty state when the playback queue has no songs.

Use the default message or add a `children` snippet to provide your own empty
state. It renders nothing while the queue contains a song.

@see `Playback.QueueList` for the sortable queue list.

@example
```svelte
<Playback.QueueEmpty>
  <li>Choose the first song.</li>
</Playback.QueueEmpty>
```
-->
<script lang="ts">
	import { cn } from "$lib/utils";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { usePlayback } from "../context.svelte";

	let {
		children,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLLIElement> & {
		children?: Snippet;
	} = $props();

	const playbackContext = usePlayback();
</script>

{#if (playbackContext.playback?.queue.length ?? 0) === 0}
	{#if children}
		{@render children()}
	{:else}
		<li
			data-slot="playback-queue-empty"
			class={cn("p-5 text-center text-sm text-muted-foreground", className)}
			{...restProps}
		>
			Nothing queued yet.
		</li>
	{/if}
{/if}
