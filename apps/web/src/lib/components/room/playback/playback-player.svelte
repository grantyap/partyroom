<!--
@component
Displays the video player using data from `Playback.Root`.

Use `<Playback.Player />` inside `Playback.Root` when building a custom playback
layout. It handles playback, the empty state, skipping, and TV mode. Add an
`empty` snippet to replace the message shown while no video is ready.

@see `Playback.NowPlaying` for the context-connected header.
@see `Playback.Error` for playback errors.

@example
```svelte
<Playback.Root {roomId}>
  <Playback.Player>
    {#snippet empty({ hasQueuedMedia })}
      <p>{hasQueuedMedia ? "Loading the next song…" : "Choose a song"}</p>
    {/snippet}
  </Playback.Player>
</Playback.Root>
```
-->
<script lang="ts" module>
	export type PlayerEmptyRenderProps = {
		hasQueuedMedia: boolean;
	};
</script>

<script lang="ts">
	import { cn } from "$lib/utils";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import { useMutation } from "convex-svelte";
	import { onMount, type Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { usePlayback } from "./context.svelte";
	import KaraokeVideo from "./karaoke-video.svelte";

	let {
		empty,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		empty?: Snippet<[PlayerEmptyRenderProps]>;
	} = $props();

	const playbackContext = usePlayback();
	const advance = useMutation(api.playback.advance);

	let playerShell = $state<HTMLElement>();

	$effect(() => {
		playbackContext.setPlayerShell(playerShell);
		return () => {
			if (playbackContext.playerShell === playerShell) {
				playbackContext.setPlayerShell(undefined);
			}
		};
	});

	onMount(() => {
		document.addEventListener("fullscreenchange", playbackContext.updateTvMode);
		return () =>
			document.removeEventListener(
				"fullscreenchange",
				playbackContext.updateTvMode,
			);
	});

	async function advancePlayback() {
		const playback = playbackContext.playback;
		if (!playback?.permissions.controlPlayback || !playback.current) return;
		await advance({
			roomId: playbackContext.roomId,
			currentKey: playback.current._id,
		});
	}
</script>

<div
	bind:this={playerShell}
	data-slot="playback-player"
	class={cn(
		"overflow-hidden rounded-xl border bg-black shadow-sm",
		playbackContext.tvMode &&
			"fixed inset-0 z-50 flex items-center bg-black",
		className,
	)}
	{...restProps}
>
	{#if playbackContext.currentMedia?.finalUrl && playbackContext.playback?.current}
		<KaraokeVideo
			class={playbackContext.tvMode ? "max-h-screen w-full" : "w-full"}
			src={playbackContext.currentMedia.finalUrl}
			lyrics={playbackContext.currentMedia.lyrics}
			title={playbackContext.currentMedia.title}
			selectedLyricsId={playbackContext.currentMedia.selectedLyricsId}
			lyricsOffsetMs={playbackContext.currentMedia.lyricsOffsetMs}
			overlayMessages={playbackContext.overlayMessages}
			timing={playbackContext.timing}
			canControl={playbackContext.playback.permissions.controlPlayback}
			onEnded={() => void advancePlayback()}
			onSkip={() => void advancePlayback()}
		/>
	{:else}
		{@const hasQueuedMedia = Boolean(playbackContext.playback?.queue.length)}
		{#if empty}
			{@render empty({ hasQueuedMedia })}
		{:else}
			<div class="flex aspect-video w-full items-center justify-center bg-zinc-950 p-8 text-center text-zinc-300">
				<div>
					<p class="text-lg font-medium">
						{hasQueuedMedia
							? "Preparing your music"
							: "Add a song to get started"}
					</p>
					<p class="mt-1 text-sm text-zinc-400">
						{hasQueuedMedia
							? "A ready song will start automatically."
							: "Paste a video URL in the queue panel."}
					</p>
				</div>
			</div>
		{/if}
	{/if}
</div>
