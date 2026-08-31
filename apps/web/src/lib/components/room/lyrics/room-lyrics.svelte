<script lang="ts">
	import KaraokeLyricLine from "$lib/components/room/playback/karaoke-lyric-line.svelte";
	import { usePlayback } from "$lib/components/room/playback/context.svelte";
	import * as RoomTabs from "$lib/components/room/tabs";
	import { Button } from "$lib/components/ui/button";
	import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
	import { tick } from "svelte";

	let { active = true }: { active?: boolean } = $props();

	const playbackContext = usePlayback();
	const lyrics = playbackContext.lyrics;

	let lyricsList = $state<HTMLDivElement | null>(null);
	let lyricLines = $state<Array<HTMLDivElement | null>>([]);
	let isFollowing = $state(true);
	let lastActiveCueIndex = -1;
	let wasActive = false;
	let trackId = "";
	let autoScrollTarget: number | null = null;
	let autoScrollTimeout: number | undefined;

	function clearAutoScroll() {
		autoScrollTarget = null;
		if (autoScrollTimeout !== undefined) {
			window.clearTimeout(autoScrollTimeout);
			autoScrollTimeout = undefined;
		}
	}

	function cancelAutoScroll() {
		clearAutoScroll();
	}

	function markManualScroll() {
		cancelAutoScroll();
		if (lyrics.cues.length > 0) isFollowing = false;
	}

	function updateScrollPosition() {
		if (!lyricsList) return;
		if (autoScrollTarget !== null) {
			if (Math.abs(lyricsList.scrollTop - autoScrollTarget) <= 2) {
				clearAutoScroll();
			}
			return;
		}
		if (lyrics.cues.length > 0) isFollowing = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (
			[
				"ArrowDown",
				"ArrowUp",
				"PageDown",
				"PageUp",
				"Home",
				"End",
			].includes(event.key)
		) {
			markManualScroll();
		}
	}

	function scrollToCurrentLine(behavior: ScrollBehavior = "smooth") {
		const line =
			lyrics.activeCueIndex >= 0
				? lyricLines[lyrics.activeCueIndex]
				: undefined;
		if (!lyricsList || !line) return;

		const maxScrollTop = Math.max(0, lyricsList.scrollHeight - lyricsList.clientHeight);
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
		autoScrollTarget = target;
		if (autoScrollTimeout !== undefined) window.clearTimeout(autoScrollTimeout);
		autoScrollTimeout = window.setTimeout(clearAutoScroll, 1_000);
		lyricsList.scrollTo({ top: target, behavior });
	}

	function syncToCurrentLine() {
		isFollowing = true;
		void tick().then(() => scrollToCurrentLine("smooth"));
	}

	$effect(() => {
		const nextTrackId =
			`${playbackContext.currentMedia?._id ?? ""}:${lyrics.selectedLyrics?.id ?? ""}`;
		if (nextTrackId === trackId) return;
		trackId = nextTrackId;
		lastActiveCueIndex = -1;
		wasActive = false;
		isFollowing = true;
		clearAutoScroll();
	});

	$effect(() => {
		const activeCueIndex = lyrics.activeCueIndex;
		lyrics.cues.length;
		if (!active) {
			wasActive = false;
			return;
		}
		if (activeCueIndex < 0) return;

		const shouldScroll =
			!wasActive || activeCueIndex !== lastActiveCueIndex;
		wasActive = true;
		lastActiveCueIndex = activeCueIndex;
		if (!shouldScroll || !isFollowing) return;

		void tick().then(() => {
			if (
				active &&
				isFollowing &&
				lyrics.activeCueIndex === activeCueIndex
			) {
				scrollToCurrentLine();
			}
		});
	});

	$effect(() => () => clearAutoScroll());
</script>

<section class="flex h-full min-h-0 flex-col" data-slot="room-lyrics">
	<div class="relative min-h-0 flex-1">
		<RoomTabs.ScrollArea
			bind:ref={lyricsList}
			class="h-full"
			tabindex={0}
			aria-label="Lyrics"
			onscroll={updateScrollPosition}
			onwheel={markManualScroll}
			ontouchstart={cancelAutoScroll}
			ontouchmove={markManualScroll}
			onpointerdown={cancelAutoScroll}
			onkeydown={handleKeydown}
		>
			{#if lyrics.isLoading}
				<div class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
					Loading lyrics…
				</div>
			{:else if lyrics.error}
				<div class="flex h-full items-center justify-center p-6 text-center text-sm text-destructive" role="alert">
					{lyrics.error}
				</div>
			{:else if !lyrics.selectedLyrics}
				<div class="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
					No synced lyrics available.
				</div>
			{:else if lyrics.cues.length === 0}
				<div class="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
					No readable lyrics available.
				</div>
			{:else}
				<div class="space-y-5 p-4 pb-8">
					{#each lyrics.cues as cue, index (`${lyrics.selectedLyrics?.id}:${cue.start}:${index}`)}
						<div
							bind:this={lyricLines[index]}
							class="transition-opacity"
							data-active={lyrics.activeCueIndex === index ? "true" : undefined}
						>
							<KaraokeLyricLine
								{cue}
								currentTime={lyrics.adjustedTime}
								wordTiming={lyrics.wordTiming}
								active={lyrics.activeCueIndex === index}
								class="text-left [&[data-lyric-line=current][data-lyric-timing=line]]:text-[oklch(0.83_0.18_85)] [&_[data-lyric-word=complete]]:text-[oklch(0.83_0.18_85)] [&_[data-lyric-word=current]]:text-[oklch(0.83_0.18_85)] [&>span]:me-[0.28em] [&>span:last-child]:me-0"
							/>
						</div>
					{/each}
				</div>
			{/if}
		</RoomTabs.ScrollArea>

		{#if !isFollowing && lyrics.cues.length > 0}
			<Button
				variant="secondary"
				size="sm"
				class="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
				onclick={syncToCurrentLine}
			>
				<RefreshCwIcon />
				Sync
			</Button>
		{/if}
	</div>
</section>
