<!--
@component
Displays lyrics controls using data from `Playback.Root`.

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
	import type { LyricsTrack } from "$lib/karaoke";

	export type LyricsRenderProps = {
		lyrics: LyricsTrack[];
		selectedLyricsId?: string | null;
		lyricsOffsetMs?: number;
		canControl: boolean;
		onLyricsChange: (lyricsId: string, offsetMs: number) => void;
	};
</script>

<script lang="ts">
	import { api } from "@partyroom/backend/convex/_generated/api";
	import { useMutation } from "convex-svelte";
	import type { Snippet } from "svelte";
	import { usePlayback } from "./context.svelte";
	import LyricsPopover from "./lyrics-popover.svelte";

	let { children }: { children?: Snippet<[LyricsRenderProps]> } = $props();

	const playbackContext = usePlayback();
	const setLyrics = useMutation(api.playback.setLyrics);

	const renderProps: LyricsRenderProps = $derived.by(() => ({
		lyrics: playbackContext.currentMedia?.lyrics ?? [],
		selectedLyricsId: playbackContext.currentMedia?.selectedLyricsId,
		lyricsOffsetMs: playbackContext.currentMedia?.lyricsOffsetMs,
		canControl:
			playbackContext.playback?.permissions.controlPlayback ?? false,
		onLyricsChange: (lyricsId, offsetMs) => {
			void setLyrics({ roomId: playbackContext.roomId, lyricsId, offsetMs });
		},
	}));
</script>

{#if children}
	{@render children(renderProps)}
{:else if renderProps.lyrics.length}
	<LyricsPopover {...renderProps} />
{/if}
