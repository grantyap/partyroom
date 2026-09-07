<script lang="ts">
	import { PUBLIC_CONVEX_URL } from "$env/static/public";
	import { Button } from "$lib/components/ui/button";
	import type { LyricsTrack } from "$lib/karaoke";
	import { SyncedMediaPlayback } from "$lib/synced-playback";
	import type { OnlineTimingObject } from "$lib/timing";
	import { browserReachableServiceUrl } from "$lib/service-url";
	import { RefreshCw } from "@lucide/svelte";
	import {
		isVideoProvider,
		type MediaProviderAdapter,
	} from "vidstack";
	import type { MediaPlayerElement } from "vidstack/elements";
	import "vidstack/player";
	import "vidstack/player/ui";
	import ChatOverlay from "../chat/chat-overlay.svelte";
	import type { OverlayMessage } from "../types";
	import { KaraokeLyricsState } from "./karaoke-lyrics-state.svelte";
	import KaraokeLyricsOverlay from "./karaoke-lyrics-overlay.svelte";
	import KaraokeVideoControls from "./karaoke-video-controls.svelte";

	type Props = {
		src: string;
		lyrics?: LyricsTrack[];
		title?: string | null;
		class?: string;
		selectedLyricsId?: string | null;
		lyricsOffsetMs?: number;
		lyricsState?: KaraokeLyricsState;
		timing?: OnlineTimingObject;
		canControl?: boolean;
		onEnded?: () => void;
		onSkip?: () => void;
		fullscreen?: boolean;
		onToggleFullscreen?: () => void;
		overlayMessages?: OverlayMessage[];
	};

	let {
		src,
		lyrics = [],
		title,
		class: className = "",
		selectedLyricsId: sharedSelectedLyricsId,
		lyricsOffsetMs: sharedLyricsOffsetMs,
		lyricsState: sharedLyricsState,
		timing,
		canControl = true,
		onEnded,
		onSkip,
		fullscreen = false,
		onToggleFullscreen,
		overlayMessages,
	}: Props = $props();

	let video = $state<HTMLVideoElement>();
	let standaloneCurrentTime = $state(0);
	let animationFrame: number | undefined;
	// The shared state is supplied by Playback.Player and remains stable for this player.
	// svelte-ignore state_referenced_locally
	const localLyricsState = sharedLyricsState
		? undefined
		: new KaraokeLyricsState({
				getLyrics: () => lyrics,
				getSelectedLyricsId: () => sharedSelectedLyricsId,
				getLyricsOffsetMs: () => sharedLyricsOffsetMs,
				getCurrentTime: () => standaloneCurrentTime,
			});
	const lyricsState = $derived(sharedLyricsState ?? localLyricsState);
	const playbackSync = new SyncedMediaPlayback({
		getElement: () => video,
		getTimingObject: () => timing,
		canControl: () => canControl,
		onSkip: () => onSkip?.(),
		alignmentToleranceSeconds: 0.01,
	});

	const availableLyrics = $derived(lyricsState?.availableLyrics ?? []);
	const captionsUrl = $derived(
		lyricsState?.captionsUrl ??
			availableLyrics.find(({ captionsUrl }) => captionsUrl)?.captionsUrl,
	);
	const videoUrl = $derived(browserReachableServiceUrl(src, PUBLIC_CONVEX_URL));
	const publicCaptionsUrl = $derived(
		captionsUrl
			? browserReachableServiceUrl(captionsUrl, PUBLIC_CONVEX_URL)
			: undefined,
	);
	const adjustedTime = $derived(lyricsState?.adjustedTime ?? 0);
	const activeCue = $derived(lyricsState?.activeCue);
	const nextCue = $derived(lyricsState?.nextCue);

	function updateTime() {
		if (sharedLyricsState) return;
		standaloneCurrentTime = timing?.query()?.position ?? video?.currentTime ?? 0;
	}

	function trackPlayback() {
		if (sharedLyricsState) return;
		updateTime();
		if (
			timing
				? timing.query()?.velocity === 1
				: video && !video.paused && !video.ended
		) {
			animationFrame = requestAnimationFrame(trackPlayback);
		}
	}

	function startTracking() {
		if (sharedLyricsState) return;
		if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
		trackPlayback();
	}

	function stopTracking() {
		if (sharedLyricsState) return;
		if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
		animationFrame = undefined;
		updateTime();
	}

	function setProvider(provider: MediaProviderAdapter | null) {
		video = isVideoProvider(provider) ? provider.video : undefined;
	}

	function listenForPlayerEvents(node: HTMLElement) {
		const player = node as MediaPlayerElement;
		const listeners = {
			"provider-change": (event: Event) =>
				setProvider((event as CustomEvent<MediaProviderAdapter | null>).detail),
			"loaded-metadata": () => {
				updateTime();
			},
			play: startTracking,
			pause: stopTracking,
			"time-update": () => {
				if (!timing) updateTime();
			},
			ended: () => {
				stopTracking();
				onEnded?.();
			},
		};
		for (const [type, listener] of Object.entries(listeners)) {
			node.addEventListener(type, listener);
		}
		const controlRequestTypes = [
			"media-play-request",
			"media-pause-request",
			"media-seeking-request",
			"media-seek-request",
		] as const;
		for (const type of controlRequestTypes) {
			node.addEventListener(type, playbackSync.handleControlRequest, true);
		}
		setProvider(player.provider);
		return {
			destroy() {
				for (const [type, listener] of Object.entries(listeners)) {
					node.removeEventListener(type, listener);
				}
				for (const type of controlRequestTypes) {
					node.removeEventListener(
						type,
						playbackSync.handleControlRequest,
						true,
					);
				}
			},
		};
	}

	$effect(() => {
		if (!timing || sharedLyricsState) return;
		timing.changeRevision;
		updateTime();
		if (timing.query()?.velocity === 1) startTracking();
		else stopTracking();
	});

	$effect(() => () => {
		if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
	});
</script>

<media-player
	use:listenForPlayerEvents
	class={`relative block overflow-hidden rounded-md bg-black ${className}`}
	src={{ src: videoUrl, type: "video/mp4" }}
	title={title ?? undefined}
	playsInline
	crossOrigin="anonymous"
	load="eager"
	preload="auto"
	keyDisabled={Boolean(timing) && !canControl}
	aria-label={title ? `Karaoke video: ${title}` : "Karaoke video"}
>
	<media-provider class="player-provider block aspect-video w-full bg-black">
		{#if publicCaptionsUrl}
			<track
				default={availableLyrics.length === 0}
				kind="captions"
				src={publicCaptionsUrl}
				label="Lyrics"
			/>
		{/if}
	</media-provider>

	{#if canControl}
		<media-gesture
			class="player-gesture absolute inset-0 z-10 block cursor-pointer"
			event="pointerup"
			action="toggle:paused"
		></media-gesture>
		<media-gesture
			class="player-gesture absolute inset-0 z-10 block"
			event="pointerup"
			action="toggle:controls"
		></media-gesture>
	{/if}

	<KaraokeVideoControls
		{timing}
		{canControl}
		{fullscreen}
		{onToggleFullscreen}
		onSkip={onSkip ? playbackSync.handleSkipRequest : undefined}
	/>

	{#if playbackSync.needsUserGesture}
		<div
			class="absolute inset-0 z-40 flex items-center justify-center bg-black/65 p-6 text-center"
		>
			<div class="flex max-w-sm flex-col items-center gap-3">
				<div>
					<p class="text-lg font-semibold text-white">
						Ready to join the party?
					</p>
				</div>
				<Button size="lg" onclick={() => void playbackSync.resume()}>
					<RefreshCw /> Sync video
				</Button>
				{#if playbackSync.error}
					<p class="text-xs text-red-300" role="alert">{playbackSync.error}</p>
				{/if}
			</div>
		</div>
	{/if}

	<ChatOverlay messages={overlayMessages} />

	{#if activeCue}
		<KaraokeLyricsOverlay
			{activeCue}
			{nextCue}
			{adjustedTime}
			wordTiming={lyricsState?.wordTiming ?? false}
		/>
	{/if}
</media-player>

<style>
	.player-provider :global(video) {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	@media (pointer: coarse) {
		.player-gesture[action="toggle:paused"] {
			display: none;
		}
	}

	@media not (pointer: coarse) {
		.player-gesture[action="toggle:controls"] {
			display: none;
		}
	}

</style>
