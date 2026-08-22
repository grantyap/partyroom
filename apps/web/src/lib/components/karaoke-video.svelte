<script lang="ts">
	import { PUBLIC_CONVEX_URL } from "$env/static/public";
	import { Button } from "$lib/components/ui/button";
	import {
		findKaraokeCue,
		karaokeWordProgress,
		lyricsIntoCues,
		parseLyricObservations,
		type KaraokeCue,
		type LyricsTrack,
	} from "$lib/karaoke";
	import { browserReachableServiceUrl } from "$lib/service-url";
	import { RefreshCw } from "@lucide/svelte";

	type Props = {
		src: string;
		lyrics?: LyricsTrack[];
		title?: string | null;
		class?: string;
		selectedLyricsId?: string | null;
		lyricsOffsetMs?: number;
		playback?: {
			status: "idle" | "playing" | "paused";
			anchorPositionMs: number;
			anchorUpdatedAt: number;
			revision: number;
			clockOffsetMs: number;
			canControl: boolean;
		};
		onPlayRequest?: (positionMs: number) => void | Promise<void>;
		onPauseRequest?: (positionMs: number) => void | Promise<void>;
		onSeekRequest?: (positionMs: number) => void | Promise<void>;
		onEnded?: () => void;
		overlayMessages?: Array<{ id: string; body: string; color: string }>;
	};

	let {
		src,
		lyrics = [],
		title,
		class: className = "",
		selectedLyricsId: sharedSelectedLyricsId,
		lyricsOffsetMs: sharedLyricsOffsetMs,
		playback,
		onPlayRequest,
		onPauseRequest,
		onSeekRequest,
		onEnded,
		overlayMessages = [],
	}: Props = $props();

	let video = $state<HTMLVideoElement>();
	let currentTime = $state(0);
	let cues = $state<KaraokeCue[]>([]);
	let animationFrame: number | undefined;
	let applyingAuthoritativeState = false;
	let ignoredSeekCommands = 0;
	let needsPlaybackSync = $state(false);
	let syncError = $state<string | null>(null);
	let isScrubbing = $state(false);
	let pendingSeekCommands = $state(0);
	let appliedPlaybackKey = "";
	let initializedOverlayMessages = false;
	let seenOverlayMessages = new Set<string>();
	let flyingMessages = $state<
		Array<{
			id: string;
			body: string;
			color: string;
			lane: number;
			duration: number;
		}>
	>([]);
	const localSeekInFlight = $derived(isScrubbing || pendingSeekCommands > 0);

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

	function authoritativePositionSeconds(state: NonNullable<Props["playback"]>) {
		const authoritativeNow = Date.now() + state.clockOffsetMs;
		return Math.max(
			0,
			(state.anchorPositionMs +
				(state.status === "playing"
					? Math.max(0, authoritativeNow - state.anchorUpdatedAt)
					: 0)) /
				1_000,
		);
	}

	function seekToAuthoritativePosition(
		element: HTMLVideoElement,
		state: NonNullable<Props["playback"]>,
	) {
		const targetSeconds = authoritativePositionSeconds(state);
		if (Math.abs(element.currentTime - targetSeconds) <= 0.5) return;
		ignoredSeekCommands += 1;
		element.currentTime = targetSeconds;
	}

	function finishApplyingAuthoritativeState() {
		setTimeout(() => {
			applyingAuthoritativeState = false;
		}, 0);
	}

	async function syncPlayback() {
		const element = video;
		const state = playback;
		if (!element || !state) return;

		applyingAuthoritativeState = true;
		syncError = null;
		seekToAuthoritativePosition(element, state);
		try {
			if (state.status === "playing") await element.play();
			else element.pause();
			needsPlaybackSync = false;
		} catch {
			needsPlaybackSync = true;
			syncError = "Safari still blocked playback. Tap Sync video again.";
		} finally {
			finishApplyingAuthoritativeState();
		}
	}

	$effect(() => {
		const element = video;
		const state = playback;
		const playbackKey = state
			? `${state.revision}:${state.status}:${state.anchorPositionMs}:${state.anchorUpdatedAt}`
			: "";
		if (
			!element ||
			!state ||
			localSeekInFlight ||
			appliedPlaybackKey === playbackKey
		)
			return;
		appliedPlaybackKey = playbackKey;
		applyingAuthoritativeState = true;
		seekToAuthoritativePosition(element, state);
		if (state.status === "playing") {
			void element
				.play()
				.then(() => {
					needsPlaybackSync = false;
					syncError = null;
				})
				.catch(() => {
					// A user gesture is required by Safari and other autoplay-restricting browsers.
					needsPlaybackSync = true;
				})
				.finally(finishApplyingAuthoritativeState);
		} else {
			element.pause();
			needsPlaybackSync = false;
			syncError = null;
			finishApplyingAuthoritativeState();
		}
	});

	$effect(() => {
		const element = video;
		const state = playback;
		if (!element || !state || state.status !== "playing" || localSeekInFlight)
			return;
		const timer = window.setInterval(() => {
			if (localSeekInFlight) return;
			const estimatedServerNow = Date.now() + state.clockOffsetMs;
			const targetSeconds = Math.max(
				0,
				(state.anchorPositionMs + estimatedServerNow - state.anchorUpdatedAt) /
					1_000,
			);
			if (Math.abs(element.currentTime - targetSeconds) <= 0.5) return;
			applyingAuthoritativeState = true;
			ignoredSeekCommands += 1;
			element.currentTime = targetSeconds;
			finishApplyingAuthoritativeState();
		}, 5_000);
		return () => window.clearInterval(timer);
	});

	$effect(() => {
		const incoming = overlayMessages;
		if (!initializedOverlayMessages) {
			seenOverlayMessages = new Set(incoming.map(({ id }) => id));
			initializedOverlayMessages = true;
			return;
		}
		for (const message of incoming) {
			if (seenOverlayMessages.has(message.id)) continue;
			seenOverlayMessages.add(message.id);
			const flying = {
				...message,
				lane: Math.floor(Math.random() * 6),
				duration: 7 + Math.random() * 4,
			};
			flyingMessages = [...flyingMessages, flying];
			setTimeout(() => {
				flyingMessages = flyingMessages.filter(({ id }) => id !== message.id);
			}, flying.duration * 1_000);
		}
	});

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
		if (!video) return;
		currentTime = video.currentTime;
	}

	function trackPlayback() {
		updateTime();
		if (video && !video.paused && !video.ended) {
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

	async function commitSeek() {
		updateTime();
		if (applyingAuthoritativeState) return;
		isScrubbing = false;
		pendingSeekCommands += 1;
		try {
			await onSeekRequest?.((video?.currentTime ?? 0) * 1_000);
		} catch (error) {
			console.error("Unable to seek room playback", error);
		} finally {
			pendingSeekCommands -= 1;
		}
	}

	$effect(() => () => {
		if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
	});
</script>

<div class={`relative overflow-hidden rounded-md bg-black ${className}`}>
	<!-- svelte-ignore a11y_media_has_caption: a WebVTT fallback is included when available -->
	<video
		bind:this={video}
		class="aspect-video w-full"
		controls={playback?.canControl ?? true}
		playsinline
		preload="metadata"
		src={videoUrl}
		aria-label={title ? `Karaoke video: ${title}` : "Karaoke video"}
		onloadedmetadata={updateTime}
		ontimeupdate={updateTime}
		onseeking={() => {
			if (!applyingAuthoritativeState && ignoredSeekCommands === 0)
				isScrubbing = true;
		}}
		onseeked={() => {
			if (ignoredSeekCommands > 0) {
				ignoredSeekCommands -= 1;
				isScrubbing = false;
				updateTime();
				return;
			}
			void commitSeek();
		}}
		onplay={() => {
			startTracking();
			if (
				!applyingAuthoritativeState &&
				!needsPlaybackSync &&
				playback?.status !== "playing"
			) {
				void onPlayRequest?.((video?.currentTime ?? 0) * 1_000);
			}
		}}
		onpause={() => {
			stopTracking();
			if (
				!applyingAuthoritativeState &&
				!needsPlaybackSync &&
				!video?.ended &&
				playback?.status === "playing"
			) {
				void onPauseRequest?.((video?.currentTime ?? 0) * 1_000);
			}
		}}
		onended={() => {
			stopTracking();
			onEnded?.();
		}}
	>
		{#if publicCaptionsUrl}
			<track
				default={availableLyrics.length === 0}
				kind="captions"
				src={publicCaptionsUrl}
				label="Lyrics"
			/>
		{/if}
	</video>

	{#if needsPlaybackSync}
		<div
			class="absolute inset-0 z-30 flex items-center justify-center bg-black/65 p-6 text-center"
		>
			<div class="flex max-w-sm flex-col items-center gap-3">
				<div>
					<p class="text-lg font-semibold text-white">
						Ready to join the party?
					</p>
				</div>
				<Button size="lg" onclick={() => void syncPlayback()}>
					<RefreshCw /> Sync video
				</Button>
				{#if syncError}
					<p class="text-xs text-red-300" role="alert">{syncError}</p>
				{/if}
			</div>
		</div>
	{/if}

	<div
		class="pointer-events-none absolute inset-0 z-20 overflow-hidden"
		aria-hidden="true"
	>
		{#each flyingMessages as message (message.id)}
			<p
				class="flying-message"
				style={`--lane: ${message.lane}; --duration: ${message.duration}s; --member-color: ${message.color}`}
			>
				{message.body}
			</p>
		{/each}
	</div>

	{#if activeCue}
		<div
			class="pointer-events-none absolute inset-x-0 bottom-0 flex min-h-[28%] flex-col justify-end bg-linear-to-t from-black/80 via-black/25 to-transparent px-4 text-center sm:pb-14 sm:px-8 pb-12"
			aria-hidden="true"
		>
			<p class="karaoke-line">
				{#each activeCue.words as word, index (`${word.time}-${index}`)}
					<span
						class="karaoke-word"
						class:karaoke-word-progress={selectedLyrics?.timing === "word"}
						class:karaoke-line-active={selectedLyrics?.timing === "line"}
						style={selectedLyrics?.timing === "word"
							? `--karaoke-progress: ${karaokeWordProgress(word, adjustedTime) * 100}%`
							: undefined}>{word.text}</span
					>
				{/each}
			</p>
			{#if nextCue}
				<p
					class="mt-1 text-sm font-semibold text-white/55 drop-shadow-md sm:mt-2 sm:text-xl"
				>
					{nextCue.words.map((word) => word.text).join(" ")}
				</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.flying-message {
		position: absolute;
		top: calc(8% + var(--lane) * 11%);
		left: 100%;
		width: max-content;
		max-width: 80%;
		animation: fly var(--duration) linear forwards;
		color: var(--member-color);
		font-size: clamp(1rem, 2.2vw, 2rem);
		font-weight: 700;
		text-shadow:
			-2px -2px 0 rgb(0 0 0 / 0.9),
			2px -2px 0 rgb(0 0 0 / 0.9),
			-2px 2px 0 rgb(0 0 0 / 0.9),
			2px 2px 0 rgb(0 0 0 / 0.9);
	}

	@keyframes fly {
		from {
			transform: translateX(0);
		}
		to {
			transform: translateX(calc(-100vw - 100%));
		}
	}

	.karaoke-line {
		font-size: clamp(1.125rem, 3.4vw, 2rem);
		font-weight: 800;
		line-height: 1.2;
		letter-spacing: -0.025em;
		text-wrap: balance;
	}

	.karaoke-word {
		display: inline;
		margin-inline-end: 0.28em;
		filter: drop-shadow(0 1px 1px rgb(0 0 0 / 95%))
			drop-shadow(0 2px 4px rgb(0 0 0 / 70%));
	}

	.karaoke-word-progress {
		--karaoke-progress: 0%;
		color: transparent;
		background: linear-gradient(
			90deg,
			oklch(0.83 0.18 85) 0%,
			oklch(0.83 0.18 85) var(--karaoke-progress),
			rgb(255 255 255 / 58%) var(--karaoke-progress),
			rgb(255 255 255 / 58%) 100%
		);
		background-clip: text;
		-webkit-background-clip: text;
	}

	.karaoke-line-active {
		color: oklch(0.83 0.18 85);
	}

	.karaoke-word:last-child {
		margin-inline-end: 0;
	}
</style>
