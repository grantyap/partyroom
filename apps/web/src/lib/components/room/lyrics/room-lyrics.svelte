<script lang="ts">
	import { usePlayback } from "$lib/components/room/playback/context.svelte";
	import PlaybackLyrics from "$lib/components/room/playback/playback-lyrics.svelte";
	import KaraokeLyricLine from "$lib/components/room/playback/karaoke-lyric-line.svelte";
	import * as RoomTabs from "$lib/components/room/tabs";
	import { ScrollFollow } from "$lib/components/scroll-follow.svelte";
	import { Button } from "$lib/components/ui/button";
	import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";

	let { active = true }: { active?: boolean } = $props();

	const playbackContext = usePlayback();
	const lyrics = playbackContext.lyrics;

	let lyricsList = $state<HTMLDivElement | null>(null);
	let lyricLines = $state<Array<HTMLDivElement | null>>([]);
	let lastActiveCueIndex = -1;
	let wasActive = false;
	let trackId = "";

	function getCurrentLineScrollTop() {
		const line =
			lyrics.activeCueIndex >= 0
				? lyricLines[lyrics.activeCueIndex]
				: undefined;
		if (!lyricsList || !line) return null;

		const maxScrollTop = Math.max(
			0,
			lyricsList.scrollHeight - lyricsList.clientHeight,
		);
		const lineTop =
			line.getBoundingClientRect().top -
			lyricsList.getBoundingClientRect().top +
			lyricsList.scrollTop;
		const target = Math.max(
			0,
			Math.min(
				maxScrollTop,
				lineTop - (lyricsList.clientHeight - line.offsetHeight) / 2,
			),
		);
		return target;
	}

	const scrollFollow = new ScrollFollow({
		getViewport: () => lyricsList,
		getTargetScrollTop: getCurrentLineScrollTop,
		canFollow: () => active && lyrics.cues.length > 0,
	});

	$effect(() => {
		const nextTrackId = `${playbackContext.currentMedia?._id ?? ""}:${lyrics.selectedLyrics?.id ?? ""}`;
		if (nextTrackId === trackId) return;
		trackId = nextTrackId;
		lastActiveCueIndex = -1;
		wasActive = false;
		scrollFollow.reset();
	});

	$effect(() => {
		const activeCueIndex = lyrics.activeCueIndex;
		lyrics.cues.length;
		if (!active) {
			wasActive = false;
			return;
		}
		if (activeCueIndex < 0) return;

		const shouldScroll = !wasActive || activeCueIndex !== lastActiveCueIndex;
		wasActive = true;
		lastActiveCueIndex = activeCueIndex;
		if (!shouldScroll || !scrollFollow.isFollowing) return;

		void scrollFollow.follow();
	});
</script>

<section class="flex h-full min-h-0 flex-col" data-slot="room-lyrics">
	{#if playbackContext.currentMedia?.lyrics.length}
		<div class="shrink-0 border-b px-4 py-1.5">
			<PlaybackLyrics />
		</div>
	{/if}
	<div class="relative min-h-0 flex-1">
		<RoomTabs.ScrollArea
			bind:ref={lyricsList}
			class="h-full"
			tabindex={0}
			aria-label="Lyrics"
			onscroll={scrollFollow.onScroll}
			onwheel={scrollFollow.onUserScroll}
			ontouchstart={scrollFollow.cancelAutoScroll}
			ontouchmove={scrollFollow.onUserScroll}
			onpointerdown={scrollFollow.cancelAutoScroll}
			onkeydown={scrollFollow.onKeydown}
		>
			{#if lyrics.isLoading}
				<div
					class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground"
				>
					Loading lyrics…
				</div>
			{:else if lyrics.error}
				<div
					class="flex h-full items-center justify-center p-6 text-center text-sm text-destructive"
					role="alert"
				>
					{lyrics.error}
				</div>
			{:else if !lyrics.selectedLyrics}
				<div
					class="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground"
				>
					No synced lyrics available.
				</div>
			{:else if lyrics.cues.length === 0}
				<div
					class="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground"
				>
					No readable lyrics available.
				</div>
			{:else}
				<div class="space-y-6 px-5 py-6">
					{#each lyrics.cues as cue, index (`${lyrics.selectedLyrics?.id}:${cue.start}:${index}`)}
						<div
							bind:this={lyricLines[index]}
							class="transition-opacity opacity-45 data-[active=true]:opacity-100"
							data-active={lyrics.activeCueIndex === index ? "true" : undefined}
						>
							<KaraokeLyricLine
								{cue}
								currentTime={lyrics.adjustedTime}
								wordTiming={lyrics.wordTiming}
								active={lyrics.activeCueIndex === index}
								class="wrap-anywhere text-left text-lg font-semibold leading-relaxed tracking-tight [&>span]:inline-block [&>span]:max-w-full [&[data-lyric-line=current][data-lyric-timing=line]]:text-primary [&_[data-lyric-word=complete]]:text-primary [&_[data-lyric-word=current]]:text-primary [&>span]:me-[0.28em] [&>span:last-child]:me-0"
							/>
						</div>
					{/each}
				</div>
			{/if}
		</RoomTabs.ScrollArea>

		{#if !scrollFollow.isFollowing && lyrics.cues.length > 0}
			<Button
				variant="secondary"
				size="sm"
				class="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
				onclick={() => void scrollFollow.sync()}
			>
				<RefreshCwIcon />
				Sync
			</Button>
		{/if}
	</div>
</section>
