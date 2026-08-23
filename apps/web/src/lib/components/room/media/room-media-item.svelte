<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { RotateCcw, Timer, Trash2 } from "@lucide/svelte";
	import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
	import KaraokeVideo from "../playback/karaoke-video.svelte";
	import { formatDuration, mediaElapsed, stageLabel } from "../media-format";
	import MediaProcessingSteps from "./media-processing-steps.svelte";
	import type { RoomMediaItem } from "../types";

	let {
		media,
		currentTime,
		reprocessingMediaId,
		removingMediaId,
		onReprocess,
		onRemove,
	}: {
		media: RoomMediaItem;
		currentTime: number;
		reprocessingMediaId: Id<"roomMedia"> | null;
		removingMediaId: Id<"roomMedia"> | null;
		onReprocess: (id: Id<"roomMedia">) => void;
		onRemove: (id: Id<"roomMedia">) => void;
	} = $props();

	const elapsed = $derived(
		mediaElapsed(media.steps, media.state === "processing", currentTime),
	);
</script>

<li class="space-y-3 rounded-lg border p-4">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h3 class="font-heading font-medium">{media.title ?? "Resolving media…"}</h3>
			<p class="text-xs text-muted-foreground">
				{media.state === "processing" ? "Processing media" : stageLabel(media.state)}
				{#if formatDuration(media.duration)} · {formatDuration(media.duration)}{/if}
			</p>
		</div>
		<div class="flex items-center gap-2">
			{#if elapsed}
				<span class="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground" title="Total elapsed processing time">
					<Timer class="size-3" aria-hidden="true" />
					{elapsed}
				</span>
			{/if}
			<span class="rounded-full bg-muted px-2 py-1 text-xs capitalize">{media.state}</span>
			<Button
				variant="outline"
				size="icon-sm"
				disabled={reprocessingMediaId !== null || removingMediaId !== null || media.state === "queued" || media.state === "processing"}
				aria-label={`Reprocess ${media.title ?? "media"}`}
				title="Reprocess media"
				onclick={() => onReprocess(media._id)}
			>
				<RotateCcw class={reprocessingMediaId === media._id ? "animate-spin" : ""} />
			</Button>
			<Button
				variant="destructive"
				size="icon-sm"
				disabled={removingMediaId !== null || reprocessingMediaId !== null}
				aria-label={`Delete ${media.title ?? "media"}`}
				title="Delete media"
				onclick={() => onRemove(media._id)}
			>
				<Trash2 />
			</Button>
		</div>
	</div>

	{#if media.state === "queued" || media.state === "processing" || media.state === "ready"}
		<MediaProcessingSteps steps={media.steps} {currentTime} />
	{:else if media.state === "failed"}
		<p class="text-sm text-destructive">{media.errorMessage ?? "Media processing failed."}</p>
	{/if}

	{#if media.finalUrl}
		<KaraokeVideo src={media.finalUrl} lyrics={media.lyrics} title={media.title} />
	{/if}

	{#if media.annotationsState === "ready"}
		<div class="flex flex-wrap gap-3 text-sm">
			{#if media.annotationsUrl}<a class="text-primary underline underline-offset-4" href={media.annotationsUrl} download>JAMS annotations</a>{/if}
			{#if media.midiUrl}<a class="text-primary underline underline-offset-4" href={media.midiUrl} download>Vocal MIDI</a>{/if}
			{#if media.musicXmlUrl}<a class="text-primary underline underline-offset-4" href={media.musicXmlUrl} download>MusicXML</a>{/if}
		</div>
	{:else if media.state === "ready" && media.annotationsState === "failed"}
		<p class="text-xs text-muted-foreground">Karaoke scoring annotations are unavailable for this media.</p>
	{/if}
</li>
