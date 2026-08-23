<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import type { LyricsTrack } from "$lib/karaoke";
	import { Maximize2 } from "@lucide/svelte";
	import LyricsPopover from "./lyrics-popover.svelte";
	import ShareRoomPopover from "./share-room-popover.svelte";

	let {
		title,
		hasQueuedMedia,
		lyrics = [],
		selectedLyricsId,
		lyricsOffsetMs,
		canControl,
		onLyricsChange,
		onToggleTvMode,
	}: {
		title?: string | null;
		hasQueuedMedia: boolean;
		lyrics?: LyricsTrack[];
		selectedLyricsId?: string | null;
		lyricsOffsetMs?: number;
		canControl: boolean;
		onLyricsChange: (lyricsId: string, offsetMs: number) => void;
		onToggleTvMode: () => void;
	} = $props();
</script>

<div class="flex items-center justify-between gap-3">
	<div>
		<p class="text-sm font-medium">Now playing</p>
		<p class="text-xs text-muted-foreground">
			{title ??
				(hasQueuedMedia
					? "Preparing the next song…"
					: "The queue is empty")}
		</p>
	</div>
	<div class="flex items-center gap-2">
		<ShareRoomPopover />
		{#if lyrics.length}
			<LyricsPopover
				{lyrics}
				{selectedLyricsId}
				{lyricsOffsetMs}
				{canControl}
				{onLyricsChange}
			/>
		{/if}
		<Button variant="outline" size="sm" onclick={onToggleTvMode}>
			<Maximize2 /> TV mode
		</Button>
	</div>
</div>
