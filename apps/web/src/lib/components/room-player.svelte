<script lang="ts">
	import KaraokeVideo from "$lib/components/karaoke-video.svelte";
	import LyricsPopover from "$lib/components/lyrics-popover.svelte";
	import MediaProgressPopover from "$lib/components/media-progress-popover.svelte";
	import ShareRoomPopover from "$lib/components/share-room-popover.svelte";
	import { Badge } from "$lib/components/ui/badge";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import {
		Maximize2,
		GripVertical,
		Plus,
		SkipForward,
		Trash2,
	} from "@lucide/svelte";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
	import { useAction, useMutation, useQuery } from "convex-svelte";
	import { onMount } from "svelte";

	type OverlayMessage = { id: string; body: string; color: string };

	let {
		roomId,
		overlayMessages = [],
	}: {
		roomId: Id<"rooms">;
		overlayMessages?: OverlayMessage[];
	} = $props();

	const playback = useQuery(api.playback.get, () => ({ roomId }));
	const roomMedia = useQuery(api.media.jobs.listRoomMedia, () => ({ roomId }));
	const requestMedia = useAction(api.media.actions.requestMedia);
	const serverClock = useAction(api.playback.clock);
	const play = useMutation(api.playback.play);
	const pause = useMutation(api.playback.pause);
	const seek = useMutation(api.playback.seek);
	const advance = useMutation(api.playback.advance);
	const remove = useMutation(api.playback.remove);
	const reorder = useMutation(api.playback.reorder);
	const setLyrics = useMutation(api.playback.setLyrics);

	const mediaById = $derived(
		new Map((roomMedia.data ?? []).map((media) => [media._id, media])),
	);
	const currentMedia = $derived(
		playback.data?.current
			? mediaById.get(playback.data.current.roomMedia)
			: undefined,
	);

	let sourceUrl = $state("");
	let submitting = $state(false);
	let error = $state<string | null>(null);
	let draggedItem = $state<Id<"roomQueueItems"> | null>(null);
	let playerShell = $state<HTMLElement>();
	let tvMode = $state(false);
	let clockOffsetMs = $state(0);

	onMount(() => {
		const updateFullscreen = () => {
			tvMode = document.fullscreenElement === playerShell;
		};
		document.addEventListener("fullscreenchange", updateFullscreen);
		return () =>
			document.removeEventListener("fullscreenchange", updateFullscreen);
	});

	onMount(() => {
		async function synchronizeClock() {
			const startedAt = Date.now();
			try {
				const serverNow = await serverClock({});
				const completedAt = Date.now();
				clockOffsetMs = serverNow - (startedAt + completedAt) / 2;
			} catch {
				// Local wall time is a reasonable fallback until the next sample succeeds.
			}
		}
		void synchronizeClock();
		const timer = window.setInterval(() => void synchronizeClock(), 60_000);
		return () => window.clearInterval(timer);
	});

	async function addSong(event: SubmitEvent) {
		event.preventDefault();
		if (!sourceUrl.trim() || submitting) return;
		submitting = true;
		error = null;
		try {
			await requestMedia({ roomId, url: sourceUrl.trim() });
			sourceUrl = "";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Unable to add song";
		} finally {
			submitting = false;
		}
	}

	async function toggleTvMode() {
		if (!playerShell) return;
		if (document.fullscreenElement === playerShell)
			await document.exitFullscreen();
		else await playerShell.requestFullscreen();
	}

	async function dropBefore(targetId: Id<"roomQueueItems"> | null) {
		const queue = playback.data?.queue ?? [];
		const moving = draggedItem;
		draggedItem = null;
		if (!moving || moving === targetId) return;
		const withoutMoving = queue.filter(({ _id }) => _id !== moving);
		const index =
			targetId === null
				? withoutMoving.length
				: withoutMoving.findIndex(({ _id }) => _id === targetId);
		if (index < 0) return;
		try {
			await reorder({
				roomId,
				queueItemId: moving,
				afterItemId: index > 0 ? withoutMoving[index - 1]._id : null,
				beforeItemId:
					index < withoutMoving.length ? withoutMoving[index]._id : null,
			});
		} catch (cause) {
			error =
				cause instanceof Error ? cause.message : "Unable to reorder queue";
		}
	}

	async function requestPlay(positionMs: number) {
		const currentQueueItem = playback.data?.current?._id;
		if (!currentQueueItem) return;
		try {
			await play(
				{ roomId, currentQueueItem, positionMs },
				{
					optimisticUpdate: (store, args) => {
						const state = store.getQuery(api.playback.get, {
							roomId: args.roomId,
						});
						if (!state || state.current?._id !== args.currentQueueItem) return;
						store.setQuery(
							api.playback.get,
							{ roomId: args.roomId },
							{
								...state,
								playback: {
									...state.playback,
									status: "playing",
									anchorPositionMs: args.positionMs,
									anchorUpdatedAt: Date.now() + clockOffsetMs,
									revision: state.playback.revision + 1,
								},
							},
						);
					},
				},
			);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Unable to play media";
		}
	}

	async function requestPause(positionMs: number) {
		const currentQueueItem = playback.data?.current?._id;
		if (!currentQueueItem) return;
		try {
			await pause(
				{ roomId, currentQueueItem, positionMs },
				{
					optimisticUpdate: (store, args) => {
						const state = store.getQuery(api.playback.get, {
							roomId: args.roomId,
						});
						if (!state || state.current?._id !== args.currentQueueItem) return;
						store.setQuery(
							api.playback.get,
							{ roomId: args.roomId },
							{
								...state,
								playback: {
									...state.playback,
									status: "paused",
									anchorPositionMs: args.positionMs,
									anchorUpdatedAt: Date.now() + clockOffsetMs,
									revision: state.playback.revision + 1,
								},
							},
						);
					},
				},
			);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Unable to pause media";
		}
	}

	async function requestSeek(positionMs: number) {
		const currentQueueItem = playback.data?.current?._id;
		if (!currentQueueItem) return;
		try {
			await seek(
				{ roomId, currentQueueItem, positionMs },
				{
					optimisticUpdate: (store, args) => {
						const state = store.getQuery(api.playback.get, {
							roomId: args.roomId,
						});
						if (!state || state.current?._id !== args.currentQueueItem) return;
						store.setQuery(
							api.playback.get,
							{ roomId: args.roomId },
							{
								...state,
								playback: {
									...state.playback,
									anchorPositionMs: args.positionMs,
									anchorUpdatedAt: Date.now() + clockOffsetMs,
									revision: state.playback.revision + 1,
								},
							},
						);
					},
				},
			);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Unable to seek media";
		}
	}

	function formatDuration(seconds?: number) {
		if (!seconds) return null;
		const minutes = Math.floor(seconds / 60);
		const remaining = Math.round(seconds % 60);
		return `${minutes}:${remaining.toString().padStart(2, "0")}`;
	}
</script>

<div class="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
	<section class="min-w-0 space-y-3">
		<div class="flex items-center justify-between gap-3">
			<div>
				<p class="text-sm font-medium">Now playing</p>
				<p class="text-xs text-muted-foreground">
					{currentMedia?.title ??
						(playback.data?.queue.length
							? "Preparing the next song…"
							: "The queue is empty")}
				</p>
			</div>
			<div class="flex items-center gap-2">
				<ShareRoomPopover />
				{#if currentMedia?.lyrics?.length}
					<LyricsPopover
						lyrics={currentMedia.lyrics}
						selectedLyricsId={currentMedia.selectedLyricsId}
						lyricsOffsetMs={currentMedia.lyricsOffsetMs}
						canControl={playback.data?.permissions.controlPlayback ?? false}
						onLyricsChange={(lyricsId, offsetMs) =>
							void setLyrics({ roomId, lyricsId, offsetMs })}
					/>
				{/if}
				<Button variant="outline" size="sm" onclick={toggleTvMode}>
					<Maximize2 /> TV mode
				</Button>
			</div>
		</div>

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
			{#if currentMedia?.finalUrl && playback.data?.current}
				<KaraokeVideo
					class={tvMode ? "max-h-screen w-full" : "w-full"}
					src={currentMedia.finalUrl}
					lyrics={currentMedia.lyrics}
					title={currentMedia.title}
					selectedLyricsId={currentMedia.selectedLyricsId}
					lyricsOffsetMs={currentMedia.lyricsOffsetMs}
					{overlayMessages}
					playback={{
						...playback.data.playback,
						clockOffsetMs,
						canControl: playback.data.permissions.controlPlayback,
					}}
					onPlayRequest={requestPlay}
					onPauseRequest={requestPause}
					onSeekRequest={requestSeek}
					onEnded={() => {
						if (
							!playback.data?.permissions.controlPlayback ||
							!playback.data.current
						)
							return;
						void advance({
							roomId,
							currentQueueItem: playback.data.current._id,
							expectedRevision: playback.data.playback.revision,
						});
					}}
				/>
			{:else}
				<div
					class="flex aspect-video w-full items-center justify-center bg-zinc-950 p-8 text-center text-zinc-300"
				>
					<div>
						<p class="text-lg font-medium">
							{playback.data?.queue.length
								? "Preparing your music"
								: "Add a song to get started"}
						</p>
						<p class="mt-1 text-sm text-zinc-400">
							{playback.data?.queue.length
								? "A ready song will start automatically."
								: "Paste a video URL in the queue panel."}
						</p>
					</div>
				</div>
			{/if}
		</div>
	</section>

	<aside class="flex min-h-0 flex-col rounded-xl border bg-card shadow-sm">
		<div class="border-b p-4">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<h2 class="font-semibold">Queue</h2>
					<Badge variant="secondary">{playback.data?.queue.length ?? 0}</Badge>
				</div>
				<div class="flex items-center gap-2">
					{#if playback.data?.permissions.controlPlayback && playback.data.current}
						<Button
							variant="outline"
							size="sm"
							onclick={() =>
								advance({
									roomId,
									currentQueueItem: playback.data!.current!._id,
									expectedRevision: playback.data!.playback.revision,
								})}
						>
							<SkipForward /> Skip
						</Button>
					{/if}
				</div>
			</div>
			{#if playback.data?.permissions.addToQueue}
				<form class="mt-3 flex gap-2" onsubmit={addSong}>
					<Input
						type="url"
						placeholder="Paste video URL"
						aria-label="Video URL"
						bind:value={sourceUrl}
						disabled={submitting}
					/>
					<Button
						size="icon"
						type="submit"
						disabled={submitting || !sourceUrl.trim()}
						aria-label="Add song"
					>
						<Plus />
					</Button>
				</form>
			{/if}
			{#if error}<p class="mt-2 text-xs text-destructive" role="alert">
					{error}
				</p>{/if}
		</div>

		<ul class="min-h-24 flex-1 space-y-2 overflow-y-auto p-3">
			{#each playback.data?.queue ?? [] as item (item._id)}
				{@const media = mediaById.get(item.roomMedia)}
				<li
					draggable={playback.data?.permissions.reorderQueue ?? false}
					ondragstart={() => (draggedItem = item._id)}
					ondragend={() => (draggedItem = null)}
					ondragover={(event) => {
						if (draggedItem) event.preventDefault();
					}}
					ondrop={(event) => {
						event.preventDefault();
						void dropBefore(item._id);
					}}
					class="group flex items-center gap-2 rounded-lg border bg-background p-2"
					class:opacity-50={draggedItem === item._id}
				>
					{#if playback.data?.permissions.reorderQueue}
						<GripVertical
							class="size-4 shrink-0 cursor-grab text-muted-foreground"
							aria-hidden="true"
						/>
					{/if}
					<div class="min-w-0 flex-1">
						<p class="text-sm font-medium">
							{media?.title ?? "Resolving media…"}
						</p>
						<p class="text-xs text-muted-foreground">
							{item.availability === "ready"
								? "Ready"
								: item.availability === "processing"
									? "Processing…"
									: "Unavailable"}
							{#if formatDuration(media?.duration)}
								· {formatDuration(media?.duration)}{/if}
						</p>
					</div>
					{#if item.availability === "processing" && media}
						<MediaProgressPopover
							title={media.title ?? "Resolving media…"}
							steps={media.steps}
						/>
					{/if}
					{#if playback.data?.permissions.removeFromQueue}
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Remove ${media?.title ?? "song"} from queue`}
							onclick={() => void remove({ roomId, queueItemId: item._id })}
						>
							<Trash2 />
						</Button>
					{/if}
				</li>
			{/each}
			{#if (playback.data?.queue.length ?? 0) === 0}
				<li class="p-5 text-center text-sm text-muted-foreground">
					Nothing queued yet.
				</li>
			{/if}
			{#if draggedItem}
				<li
					class="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground"
					ondragover={(event) => event.preventDefault()}
					ondrop={(event) => {
						event.preventDefault();
						void dropBefore(null);
					}}
				>
					Drop at end
				</li>
			{/if}
		</ul>
	</aside>
</div>
