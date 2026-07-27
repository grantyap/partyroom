<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { Progress } from "$lib/components/ui/progress";
	import KaraokeVideo from "$lib/components/karaoke-video.svelte";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
	import { RotateCcw, Timer, Trash2 } from "@lucide/svelte";
	import { useAction, useMutation, useQuery } from "convex-svelte";
	import { onMount } from "svelte";

	let { roomId }: { roomId: Id<"rooms"> } = $props();

	const roomMedia = useQuery(api.media.jobs.listRoomMedia, () => ({ roomId }));
	const requestMedia = useAction(api.media.actions.requestMedia);
	const reprocessMedia = useMutation(api.media.jobs.reprocess);
	const removeMedia = useMutation(api.media.jobs.removeFromRoom);

	let sourceUrl = $state("");
	let submitting = $state(false);
	let reprocessingMediaId = $state<Id<"roomMedia"> | null>(null);
	let removingMediaId = $state<Id<"roomMedia"> | null>(null);
	let error = $state<string | null>(null);
	let currentTime = $state(Date.now());

	onMount(() => {
		const timer = window.setInterval(() => {
			currentTime = Date.now();
		}, 1_000);
		return () => window.clearInterval(timer);
	});

	function stageLabel(stage: string) {
		const labels: Record<string, string> = {
			resolve: "Resolve source",
			fetchLyrics: "Fetch synced lyrics",
			download: "Download source",
			extractAudio: "Extract audio",
			separate: "Separate stems",
			transcribe: "Transcribe lyrics",
			analyzeMelody: "Analyze melody",
			mux: "Build final video",
			assembleAnnotations: "Assemble annotations",
		};
		return (
			labels[stage] ??
			stage
				.replace(/([A-Z])/g, " $1")
				.replace(/^./, (letter) => letter.toUpperCase())
		);
	}

	function statusLabel(status: string) {
		if (status === "running") return "Working";
		if (status === "queued") return "Queued";
		if (status === "completed") return "Done";
		if (status === "failed") return "Unavailable";
		return "Waiting";
	}

	function formatElapsed(milliseconds: number) {
		const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
	}

	function stepTimingLabel(step: {
		state: string;
		startedAt?: number;
		completedAt?: number;
	}) {
		if (step.startedAt === undefined) return null;
		const elapsed = formatElapsed(
			(step.completedAt ?? currentTime) - step.startedAt,
		);
		return step.state === "completed"
			? `Completed in ${elapsed}`
			: step.state === "failed"
				? `Stopped after ${elapsed}`
				: step.state === "running"
					? elapsed
					: null;
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

	async function reprocess(roomMediaId: Id<"roomMedia">) {
		if (reprocessingMediaId) return;
		reprocessingMediaId = roomMediaId;
		error = null;
		try {
			await reprocessMedia({ roomId, roomMediaId });
		} catch (cause) {
			error =
				cause instanceof Error ? cause.message : "Unable to reprocess media";
		} finally {
			reprocessingMediaId = null;
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
		<p class="text-sm text-destructive" role="alert">
			Unable to load room media.
		</p>
	{:else if roomMedia.data?.length === 0}
		<p
			class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
		>
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
								{media.state === "processing"
									? "Processing media"
									: stageLabel(media.state)}
								{#if formatDuration(media.duration)}
									· {formatDuration(media.duration)}
								{/if}
							</p>
						</div>
						<div class="flex items-center gap-2">
							<span class="rounded-full bg-muted px-2 py-1 text-xs capitalize"
								>{media.state}</span
							>
							<Button
								variant="outline"
								size="icon-sm"
								disabled={reprocessingMediaId !== null ||
									removingMediaId !== null ||
									media.state === "queued" ||
									media.state === "processing"}
								aria-label={`Reprocess ${media.title ?? "media"}`}
								title="Reprocess media"
								onclick={() => reprocess(media._id)}
							>
								<RotateCcw
									class={reprocessingMediaId === media._id
										? "animate-spin"
										: ""}
								/>
							</Button>
							<Button
								variant="destructive"
								size="icon-sm"
								disabled={removingMediaId !== null ||
									reprocessingMediaId !== null}
								aria-label={`Delete ${media.title ?? "media"}`}
								title="Delete media"
								onclick={() => remove(media._id)}
							>
								<Trash2 />
							</Button>
						</div>
					</div>

					{#if media.state === "queued" || media.state === "processing" || media.state === "ready"}
						<ul
							class="grid gap-2 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]"
						>
							{#each media.steps as step (step.kind)}
								{@const timingLabel = stepTimingLabel(step)}
								<li class="rounded-md border bg-muted/20 p-2.5">
									<div class="flex items-center justify-between gap-3 text-xs">
										<span class="font-medium">{stageLabel(step.kind)}</span>
										{#if timingLabel}
											<span
												class="flex items-center gap-1 tabular-nums text-muted-foreground"
											>
												<Timer class="size-3" aria-hidden="true" />
												{timingLabel}
											</span>
										{:else}
											<span class="text-muted-foreground"
												>{statusLabel(step.state)}</span
											>
										{/if}
									</div>
									{#if step.state === "running" || step.state === "queued"}
										<div class="flex gap-2 items-center mt-2">
											<Progress
												value={step.progress * 100}
												aria-label={`${stageLabel(step.kind)} ${Math.round(step.progress * 100)}%`}
												class="flex-1"
											/>
											<output
												class="text-xs text-muted-foreground tabular-nums w-[4ch] text-end"
											>
												{Math.round(step.progress * 100)}%
											</output>
										</div>
									{/if}
									{#if step.message && (step.state === "running" || step.state === "queued")}
										<p
											class="mt-1.5 truncate text-xs text-muted-foreground"
											title={step.message}
										>
											{step.message}
										</p>
									{/if}
								</li>
							{/each}
						</ul>
					{:else if media.state === "failed"}
						<p class="text-sm text-destructive">
							{media.errorMessage ?? "Media processing failed."}
						</p>
					{/if}

					{#if media.finalUrl}
						<KaraokeVideo
							src={media.finalUrl}
							lyrics={media.lyrics}
							title={media.title}
						/>
					{/if}

					{#if media.annotationsState === "ready"}
						<div class="flex flex-wrap gap-3 text-sm">
							{#if media.annotationsUrl}
								<a
									class="text-primary underline underline-offset-4"
									href={media.annotationsUrl}
									download>JAMS annotations</a
								>
							{/if}
							{#if media.midiUrl}
								<a
									class="text-primary underline underline-offset-4"
									href={media.midiUrl}
									download>Vocal MIDI</a
								>
							{/if}
							{#if media.musicXmlUrl}
								<a
									class="text-primary underline underline-offset-4"
									href={media.musicXmlUrl}
									download>MusicXML</a
								>
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
