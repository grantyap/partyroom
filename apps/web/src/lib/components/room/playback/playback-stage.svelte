<script lang="ts">
	import { api } from "@partyroom/backend/convex/_generated/api";
	import { useMutation } from "convex-svelte";
	import { onMount } from "svelte";
	import { usePlayback } from "./context.svelte";
	import KaraokeVideo from "./karaoke-video.svelte";
	import NowPlayingHeader from "./now-playing-header.svelte";

	const playbackContext = usePlayback();
	const advance = useMutation(api.playback.advance);
	const setLyrics = useMutation(api.playback.setLyrics);
	const roomId = $derived(playbackContext.roomId);
	const playback = $derived(playbackContext.playback);
	const currentMedia = $derived(playbackContext.currentMedia);
	const overlayMessages = $derived(playbackContext.overlayMessages);

	let playerShell = $state<HTMLElement>();
	let tvMode = $state(false);

	onMount(() => {
		const updateFullscreen = () => {
			tvMode = document.fullscreenElement === playerShell;
		};
		document.addEventListener("fullscreenchange", updateFullscreen);
		return () =>
			document.removeEventListener("fullscreenchange", updateFullscreen);
	});

	async function toggleTvMode() {
		if (!playerShell) return;
		if (document.fullscreenElement === playerShell)
			await document.exitFullscreen();
		else await playerShell.requestFullscreen();
	}

	async function advancePlayback() {
		if (!playback?.permissions.controlPlayback || !playback.current) return;
		await advance({
			roomId,
			currentKey: playback.current._id,
		});
	}
</script>

<section class="min-w-0 space-y-3" data-slot="playback-stage">
	<NowPlayingHeader
		title={currentMedia?.title}
		hasQueuedMedia={Boolean(playback?.queue.length)}
		lyrics={currentMedia?.lyrics}
		selectedLyricsId={currentMedia?.selectedLyricsId}
		lyricsOffsetMs={currentMedia?.lyricsOffsetMs}
		canControl={playback?.permissions.controlPlayback ?? false}
		onLyricsChange={(lyricsId, offsetMs) =>
			void setLyrics({ roomId, lyricsId, offsetMs })}
		onToggleTvMode={() => void toggleTvMode()}
	/>

	<div
		bind:this={playerShell}
		class:fixed={tvMode}
		class:inset-0={tvMode}
		class:z-50={tvMode}
		class:bg-black={tvMode}
		class:flex={tvMode}
		class:items-center={tvMode}
		class="overflow-hidden rounded-xl border bg-black shadow-sm"
	>
		{#if currentMedia?.finalUrl && playback?.current}
			<KaraokeVideo
				class={tvMode ? "max-h-screen w-full" : "w-full"}
				src={currentMedia.finalUrl}
				lyrics={currentMedia.lyrics}
				title={currentMedia.title}
				selectedLyricsId={currentMedia.selectedLyricsId}
				lyricsOffsetMs={currentMedia.lyricsOffsetMs}
				{overlayMessages}
				timing={playbackContext.timing}
				canControl={playback.permissions.controlPlayback}
				onEnded={() => void advancePlayback()}
				onSkip={() => void advancePlayback()}
			/>
		{:else}
			<div class="flex aspect-video w-full items-center justify-center bg-zinc-950 p-8 text-center text-zinc-300">
				<div>
					<p class="text-lg font-medium">
						{playback?.queue.length
							? "Preparing your music"
							: "Add a song to get started"}
					</p>
					<p class="mt-1 text-sm text-zinc-400">
						{playback?.queue.length
							? "A ready song will start automatically."
							: "Paste a video URL in the queue panel."}
					</p>
				</div>
			</div>
		{/if}
	</div>
	{#if playbackContext.error}
		<p class="text-xs text-destructive" role="alert">
			{playbackContext.error}
		</p>
	{/if}
</section>
