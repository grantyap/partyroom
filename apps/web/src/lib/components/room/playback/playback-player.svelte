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
	import { Button } from "#lib/components/ui/button/index.js";
	import { Minimize2 } from "@lucide/svelte";
	import { cn } from "#lib/utils.js";
	import { api } from "@partyroom/backend/convex/_generated/api.js";
	import { useMutation } from "convex-svelte";
	import type { Snippet } from "svelte";
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
	const transpose = useMutation(api.playback.transpose);
	const setLyrics = useMutation(api.playback.setLyrics);
	let transposePending = $state(false);
	let transposeError = $state<string | null>(null);
	const currentKey = $derived(playbackContext.playback?.current?._id);
	$effect(() => {
		currentKey;
		transposeError = null;
	});

	async function setTransposition(semitones: number) {
		const playback = playbackContext.playback;
		if (!playback?.permissions.controlPlayback || !playback.current || transposePending) return;
		transposePending = true;
		transposeError = null;
		const key = playback.current._id;
		try {
			await transpose({ roomId: playbackContext.roomId, currentKey: key, semitones });
		} catch {
			if (currentKey === key) transposeError = "Unable to change the key. Try again.";
		} finally {
			transposePending = false;
		}
	}

	async function advancePlayback() {
		const playback = playbackContext.playback;
		if (!playback?.permissions.controlPlayback || !playback.current) return;
		await advance({
			roomId: playbackContext.roomId,
			currentKey: playback.current._id,
		});
	}

	async function changeLyrics(lyricsId: string, offsetMs: number) {
		if (!playbackContext.playback?.permissions.controlPlayback) return;
		await setLyrics({ roomId: playbackContext.roomId, lyricsId, offsetMs });
	}
</script>

<svelte:document onfullscreenchange={playbackContext.handleFullscreenChange} />

<div
	bind:this={playbackContext.playerShell}
	data-slot="playback-player"
	class={cn(
		"overflow-hidden rounded-xl border bg-black shadow-sm",
		playbackContext.tvMode &&
			"fixed inset-0 z-50 flex items-center justify-center bg-black",
		className,
	)}
	{...restProps}
>
	{#if playbackContext.tvMode}
		<Button
			class="absolute top-4 right-4 z-50 rounded-lg bg-zinc-900/80 text-white hover:bg-zinc-800 hover:text-white"
			variant="ghost"
			size="sm"
			onclick={() => void playbackContext.toggleTvMode()}
		>
			<Minimize2 /> Exit TV mode
		</Button>
	{/if}
	{#if playbackContext.currentMedia?.finalUrl && playbackContext.playback?.current}
		<KaraokeVideo
			class={playbackContext.tvMode ? "max-h-screen w-full" : "w-full"}
			src={playbackContext.currentMedia.finalUrl}
			instrumentalSrc={playbackContext.currentMedia.instrumentalUrl}
			transposeSemitones={playbackContext.playback.current.transposeSemitones}
			onTranspose={setTransposition}
			onLyricsChange={changeLyrics}
			settingsKey={currentKey}
			{transposePending}
			{transposeError}
			lyrics={playbackContext.currentMedia.lyrics}
			title={playbackContext.currentMedia.title}
			selectedLyricsId={playbackContext.currentMedia.selectedLyricsId}
			lyricsOffsetMs={playbackContext.currentMedia.lyricsOffsetMs}
			lyricsState={playbackContext.lyrics}
			overlayMessages={playbackContext.overlayMessages}
			timing={playbackContext.timing}
			canControl={playbackContext.playback.permissions.controlPlayback}
			fullscreen={playbackContext.tvMode}
			onToggleFullscreen={() => void playbackContext.toggleTvMode()}
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
					<p class="font-heading text-lg font-medium">
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
