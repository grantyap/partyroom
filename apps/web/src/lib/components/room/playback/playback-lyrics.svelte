<!--
@component
Displays the selected lyrics source using data from `Playback.Root`.

The default control renders only when lyrics are available. Add a `children`
snippet to provide your own UI.

@see `Playback.NowPlaying` for the current song.

@example
```svelte
<Playback.Lyrics>
  {#snippet children({ lyrics })}
    <span>{lyrics.length} lyrics tracks</span>
  {/snippet}
</Playback.Lyrics>
```
-->
<script lang="ts" module>
	import type { LyricsTrack } from "#lib/karaoke.js";

	export type LyricsRenderProps = {
		lyrics: LyricsTrack[];
		selectedLyricsId?: string | null;
		lyricsOffsetMs?: number;
		canControl: boolean;
		onLyricsChange: (lyricsId: string, offsetMs: number) => void | Promise<void>;
	};
</script>

<script lang="ts">
	import { api } from "@partyroom/backend/convex/_generated/api.js";
	import { useMutation } from "convex-svelte";
	import type { Snippet } from "svelte";
	import { usePlayback } from "./context.svelte";

	let { children }: { children?: Snippet<[LyricsRenderProps]> } = $props();

	const playbackContext = usePlayback();
	const setLyrics = useMutation(api.playback.setLyrics);

	const renderProps: LyricsRenderProps = $derived.by(() => ({
		lyrics: playbackContext.currentMedia?.lyrics ?? [],
		selectedLyricsId: playbackContext.currentMedia?.selectedLyricsId,
		lyricsOffsetMs: playbackContext.currentMedia?.lyricsOffsetMs,
		canControl:
			playbackContext.playback?.permissions.controlPlayback ?? false,
		onLyricsChange: async (lyricsId, offsetMs) => {
			await setLyrics({ roomId: playbackContext.roomId, lyricsId, offsetMs });
		},
	}));
</script>

{#if children}
	{@render children(renderProps)}
{:else if renderProps.lyrics.length}
	{@const delay = renderProps.lyricsOffsetMs ?? playbackContext.lyrics.selectedLyrics?.suggestedOffsetMs ?? 0}
	<p class="min-w-0 truncate text-xs text-muted-foreground">
		{playbackContext.lyrics.selectedLyrics?.label ?? "No source"}
		<span class="mx-1" aria-hidden="true">·</span>
		<span class="tabular-nums">{delay === 0 ? "No delay" : `${delay > 0 ? "+" : ""}${delay / 1000}s delay`}</span>
	</p>
{/if}
