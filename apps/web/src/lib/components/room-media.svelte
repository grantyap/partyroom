<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { Progress } from "$lib/components/ui/progress";
	import KaraokeVideo from "$lib/components/karaoke-video.svelte";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
	import { Trash2 } from "@lucide/svelte";
	import { useAction, useMutation, useQuery } from "convex-svelte";

	let { roomId }: { roomId: Id<"rooms"> } = $props();

	const roomMedia = useQuery(api.media.jobs.listRoomMedia, () => ({ roomId }));
	const requestMedia = useAction(api.media.actions.requestMedia);
	const removeMedia = useMutation(api.media.jobs.removeFromRoom);

	let sourceUrl = $state("");
	let submitting = $state(false);
	let removingMediaId = $state<Id<"roomMedia"> | null>(null);
	let error = $state<string | null>(null);

	function stageLabel(stage: string) {
		return stage.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
	}

	function formatDuration(seconds?: number) {
		if (!seconds) return null;
		const minutes = Math.floor(seconds / 60);
		const remaining = Math.round(seconds % 60);
		return `${minutes}:${remaining.toString().padStart(2, "0")}`;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!sourceUrl.trim() || submitting) return;
		submitting = true;
		error = null;
		try {
			await requestMedia({ roomId, url: sourceUrl.trim() });
			sourceUrl = "";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Unable to queue media";
		} finally {
			submitting = false;
		}
	}

	async function remove(roomMediaId: Id<"roomMedia">) {
		if (removingMediaId) return;
		removingMediaId = roomMediaId;
		error = null;
		try {
			await removeMedia({ roomId, roomMediaId });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Unable to delete media";
		} finally {
			removingMediaId = null;
		}
	}
</script>

<section class="space-y-4">
	<div>
		<h2 class="text-xl font-medium">Media</h2>
		<p class="text-sm text-muted-foreground">
			Paste a video URL to prepare a vocal-free version for this room.
		</p>
	</div>

	<form class="flex items-center gap-2" onsubmit={submit}>
		<Input
			type="url"
			placeholder="https://…"
			aria-label="Media URL"
			bind:value={sourceUrl}
			disabled={submitting}
			class="flex-1"
		/>
		<Button type="submit" disabled={submitting || !sourceUrl.trim()}>
			{submitting ? "Queuing…" : "Add media"}
		</Button>
	</form>
	{#if error}
		<p class="text-sm text-destructive" role="alert">{error}</p>
	{/if}

	{#if roomMedia.isLoading}
		<p class="text-sm text-muted-foreground">Loading room media…</p>
	{:else if roomMedia.error}
		<p class="text-sm text-destructive" role="alert">Unable to load room media.</p>
	{:else if roomMedia.data?.length === 0}
		<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
			No media has been added yet.
		</p>
	{:else}
		<ul class="space-y-4">
			{#each roomMedia.data ?? [] as media (media._id)}
				<li class="space-y-3 rounded-lg border p-4">
					<div class="flex items-start justify-between gap-4">
						<div>
							<h3 class="font-medium">{media.title ?? "Resolving media…"}</h3>
							<p class="text-xs text-muted-foreground">
								{stageLabel(media.stage)}
								{#if formatDuration(media.duration)}
									· {formatDuration(media.duration)}
								{/if}
							</p>
						</div>
						<div class="flex items-center gap-2">
							<span class="rounded-full bg-muted px-2 py-1 text-xs capitalize">{media.state}</span>
							<Button
								variant="destructive"
								size="icon-sm"
								disabled={removingMediaId !== null}
								aria-label={`Delete ${media.title ?? "media"}`}
								title="Delete media"
								onclick={() => remove(media._id)}
							>
								<Trash2 />
							</Button>
						</div>
					</div>

					{#if media.state === "queued" || media.state === "processing"}
						<div class="space-y-1">
							<Progress value={media.progress * 100} aria-label={`${Math.round(media.progress * 100)}% processed`} />
							<p class="text-right text-xs tabular-nums text-muted-foreground">
								{Math.round(media.progress * 100)}%
							</p>
						</div>
					{:else if media.state === "failed"}
						<p class="text-sm text-destructive">{media.errorMessage ?? "Media processing failed."}</p>
					{/if}

					{#if media.finalUrl}
						<KaraokeVideo
							src={media.finalUrl}
							timedLyricsUrl={media.timedLyricsUrl}
							annotationsUrl={media.annotationsUrl}
							captionsUrl={media.lyricsUrl}
							title={media.title}
						/>
					{/if}

					{#if media.annotationsState === "ready"}
						<div class="flex flex-wrap gap-3 text-sm">
							{#if media.annotationsUrl}
								<a class="text-primary underline underline-offset-4" href={media.annotationsUrl} download>JAMS annotations</a>
							{/if}
							{#if media.midiUrl}
								<a class="text-primary underline underline-offset-4" href={media.midiUrl} download>Vocal MIDI</a>
							{/if}
							{#if media.musicXmlUrl}
								<a class="text-primary underline underline-offset-4" href={media.musicXmlUrl} download>MusicXML</a>
							{/if}
						</div>
					{:else if media.state === "ready" && media.annotationsState === "failed"}
						<p class="text-xs text-muted-foreground">
							Karaoke scoring annotations are unavailable for this media.
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
