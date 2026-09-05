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
	import { ListMusic } from "@lucide/svelte";
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
			class={cn("flex flex-col items-center px-5 py-8 text-center text-sm text-muted-foreground", className)}
			{...restProps}
		>
			<ListMusic class="mb-3 size-7 opacity-50" strokeWidth={1.5} />
			<p class="font-medium text-foreground">Room for another song</p>
			<p class="mt-1 max-w-52 text-xs leading-relaxed">{playbackContext.playback?.permissions.addToQueue ? "Paste a video link below to add your pick." : "The next songs will appear here."}</p>
		</li>
	{/if}
{/if}
