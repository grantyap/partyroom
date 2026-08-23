<script lang="ts">
	import { PUBLIC_CONVEX_URL } from "$env/static/public";
	import { Button } from "$lib/components/ui/button";
	import {
		findKaraokeCue,
		lyricsIntoCues,
		parseLyricObservations,
		type KaraokeCue,
		type LyricsTrack,
	} from "$lib/karaoke";
	import { MediaPlaybackSync } from "$lib/media-playback-sync.svelte";
	import type { OnlineTimingObject } from "$lib/online-timing-object.svelte";
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
	import KaraokeLyricsOverlay from "./karaoke-lyrics-overlay.svelte";
	import KaraokeVideoControls from "./karaoke-video-controls.svelte";
	import type { OverlayMessage } from "../types";

	type Props = {
		src: string;
		lyrics?: LyricsTrack[];
		title?: string | null;
		class?: string;
		selectedLyricsId?: string | null;
		lyricsOffsetMs?: number;
		timing?: OnlineTimingObject;
		canControl?: boolean;
		onEnded?: () => void;
		onSkip?: () => void;
		overlayMessages?: OverlayMessage[];
	};

	let {
		src,
		lyrics = [],
		title,
		class: className = "",
		selectedLyricsId: sharedSelectedLyricsId,
		lyricsOffsetMs: sharedLyricsOffsetMs,
		timing,
		canControl = true,
		onEnded,
		onSkip,
		overlayMessages = [],
	}: Props = $props();

	let video = $state<HTMLVideoElement>();
	let currentTime = $state(0);
	let cues = $state<KaraokeCue[]>([]);
	let animationFrame: number | undefined;
	const playbackSync = new MediaPlaybackSync({
		getElement: () => video,
		getTimingObject: () => timing,
		canControl: () => canControl,
		onSkip: () => onSkip?.(),
		alignmentToleranceSeconds: 0.01,
	});

	const availableLyrics = $derived(
		lyrics.filter(({ content }) =>
			content.kind === "url"
				? content.url.length > 0
				: content.observations.length > 0,
		),
	);
	const selectedLyrics = $derived(
		availableLyrics.find(({ id }) => id === sharedSelectedLyricsId) ??
			availableLyrics[0],
	);
	const captionsUrl = $derived(
		selectedLyrics?.captionsUrl ??
			availableLyrics.find(({ captionsUrl }) => captionsUrl)?.captionsUrl,
	);
	const videoUrl = $derived(browserReachableServiceUrl(src, PUBLIC_CONVEX_URL));
	const publicCaptionsUrl = $derived(
		captionsUrl
			? browserReachableServiceUrl(captionsUrl, PUBLIC_CONVEX_URL)
			: undefined,
	);
	const lyricsOffsetMs = $derived(
		sharedLyricsOffsetMs !== undefined
			? sharedLyricsOffsetMs
			: selectedLyrics
				? (selectedLyrics.suggestedOffsetMs ?? 0)
				: 0,
	);
	const adjustedTime = $derived(
		currentTime -
			(Number.isFinite(lyricsOffsetMs) ? lyricsOffsetMs : 0) / 1_000,
	);
	const activeCueIndex = $derived(findKaraokeCue(cues, adjustedTime));
	const activeCue = $derived(
		activeCueIndex >= 0 ? cues[activeCueIndex] : undefined,
	);
	const nextCue = $derived(
		activeCueIndex >= 0 ? cues[activeCueIndex + 1] : undefined,
	);

	$effect(() => {
		const track = selectedLyrics;
		cues = [];
		if (!track) return;
		if (track.content.kind === "inline") {
			cues = lyricsIntoCues(track.content.observations, track.timing);
			return;
		}

		const controller = new AbortController();
		void fetch(
			browserReachableServiceUrl(track.content.url, PUBLIC_CONVEX_URL),
			{
				signal: controller.signal,
			},
		)
			.then((response) => {
				if (!response.ok)
					throw new Error(`Unable to load lyrics: HTTP ${response.status}`);
				return response.json();
			})
			.then((document: unknown) => {
				cues = lyricsIntoCues(parseLyricObservations(document), track.timing);
			})
			.catch((error: unknown) => {
				if (!(error instanceof DOMException && error.name === "AbortError")) {
					console.error("Unable to load karaoke lyrics", error);
				}
			});

		return () => controller.abort();
	});

	function updateTime() {
		currentTime = timing?.query()?.position ?? video?.currentTime ?? 0;
	}

	function trackPlayback() {
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
		if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
		trackPlayback();
	}

	function stopTracking() {
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
				playbackSync.handleLoadedMetadata();
			},
			play: startTracking,
			playing: playbackSync.handlePlaying,
			pause: stopTracking,
			"time-update": () => {
				if (!timing) updateTime();
			},
			"can-play": playbackSync.handleCanPlay,
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
		if (!timing) return;
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
			class="player-gesture absolute inset-x-0 top-0 z-10 block aspect-video cursor-pointer"
			event="pointerup"
			action="toggle:paused"
		></media-gesture>
		<media-gesture
			class="player-gesture absolute inset-x-0 top-0 z-10 block aspect-video"
			event="pointerup"
			action="toggle:controls"
		></media-gesture>
	{/if}

	<KaraokeVideoControls
		{timing}
		{canControl}
		onSkip={onSkip ? playbackSync.handleSkipRequest : undefined}
	/>

	{#if playbackSync.needsUserGesture}
		<div
			class="absolute inset-x-0 top-0 z-40 flex aspect-video items-center justify-center bg-black/65 p-6 text-center"
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
			wordTiming={selectedLyrics?.timing === "word"}
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
