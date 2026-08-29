<!--
@component
Displays the number of songs in the queue using data from `Playback.Root`.

Use the default badge or add a `children` snippet to show the count another way.

@see `Playback.Queue` for the default queue interface.

@example
```svelte
<Playback.QueueCount>
  {#snippet children({ count })}
    <span>{count} songs</span>
  {/snippet}
</Playback.QueueCount>
```
-->
<script lang="ts" module>
	export type QueueCountRenderProps = {
		count: number;
	};
</script>

<script lang="ts">
	import { Badge } from "$lib/components/ui/badge";
	import type { Snippet } from "svelte";
	import { usePlayback } from "../context.svelte";

	let { children }: { children?: Snippet<[QueueCountRenderProps]> } = $props();

	const playbackContext = usePlayback();
	const count = $derived(playbackContext.playback?.queue.length ?? 0);
</script>

{#if children}
	{@render children({ count })}
{:else}
	<Badge variant="secondary">{count}</Badge>
{/if}
