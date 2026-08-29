<!--
@component
Displays the current song using data from `Playback.Root`.

Use `<Playback.NowPlaying />` for the default label and song title. Add a
`children` snippet to change how it looks.

@see `Playback.Player` for the context-connected video player.
@see `Playback.Lyrics` for lyrics controls.
@see `Playback.TvMode` for the TV mode control.

@example
```svelte
<Playback.Root {roomId}>
  <Playback.NowPlaying>
    {#snippet children({ title, hasQueuedMedia })}
      <strong>{title ?? (hasQueuedMedia ? "Loading…" : "Nothing playing")}</strong>
    {/snippet}
  </Playback.NowPlaying>
</Playback.Root>
```
-->
<script lang="ts" module>
	export type NowPlayingRenderProps = {
		title?: string | null;
		hasQueuedMedia: boolean;
	};
</script>

<script lang="ts">
	import type { Snippet } from "svelte";
	import { usePlayback } from "./context.svelte";

	let { children }: { children?: Snippet<[NowPlayingRenderProps]> } = $props();

	const playbackContext = usePlayback();

	const renderProps: NowPlayingRenderProps = $derived.by(() => ({
		title: playbackContext.currentMedia?.title,
		hasQueuedMedia: Boolean(playbackContext.playback?.queue.length),
	}));
</script>

{#if children}
	{@render children(renderProps)}
{:else}
	<div data-slot="playback-now-playing">
		<p class="text-sm font-medium">Now playing</p>
		<p class="text-xs text-muted-foreground">
			{renderProps.title ??
				(renderProps.hasQueuedMedia
					? "Preparing the next song…"
					: "The queue is empty")}
		</p>
	</div>
{/if}
