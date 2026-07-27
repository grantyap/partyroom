<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import {
		findKaraokeCue,
		karaokeWordProgress,
		lyricsIntoCues,
		parseLyricObservations,
		type KaraokeCue,
		type LyricsTrack,
	} from "$lib/karaoke";

	type Props = {
		src: string;
		lyrics?: LyricsTrack[];
		title?: string | null;
		class?: string;
	};

	let { src, lyrics = [], title, class: className = "" }: Props = $props();

	let video = $state<HTMLVideoElement>();
	let currentTime = $state(0);
	let cues = $state<KaraokeCue[]>([]);
	let selectedLyricsId = $state<string | null>(null);
	let lyricsOffsetsMs = $state<Record<string, number>>({});
	let animationFrame: number | undefined;

	const availableLyrics = $derived(
		lyrics.filter(({ content }) =>
			content.kind === "url"
				? content.url.length > 0
				: content.observations.length > 0,
		),
	);
	const selectedLyrics = $derived(
		availableLyrics.find(({ id }) => id === selectedLyricsId) ??
			availableLyrics[0],
	);
	const captionsUrl = $derived(
		selectedLyrics?.captionsUrl ??
			availableLyrics.find(({ captionsUrl }) => captionsUrl)?.captionsUrl,
	);
	const lyricsOffsetMs = $derived(
		selectedLyrics
			? (lyricsOffsetsMs[selectedLyrics.id] ??
					selectedLyrics.suggestedOffsetMs ??
					0)
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
		if (
			availableLyrics.length > 0 &&
			!availableLyrics.some(({ id }) => id === selectedLyricsId)
		) {
			selectedLyricsId = availableLyrics[0].id;
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
		void fetch(track.content.url, { signal: controller.signal })
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

	function setLyricsOffset(value: number) {
		if (!selectedLyrics) return;
		const offset = Number.isFinite(value) ? value : 0;
		lyricsOffsetsMs[selectedLyrics.id] = Math.max(
			-30_000,
			Math.min(30_000, offset),
		);
	}

	function nudgeLyrics(delta: number) {
		setLyricsOffset(lyricsOffsetMs + delta);
	}

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

	$effect(() => () => {
		if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
	});
</script>

<div class={`relative overflow-hidden rounded-md bg-black ${className}`}>
	{#if availableLyrics.length > 0}
		<div
			class="absolute top-2 right-2 z-10 flex flex-wrap items-center justify-end gap-1 rounded-4xl bg-black/75 p-1 text-white shadow-lg backdrop-blur-sm"
		>
			{#if availableLyrics.length > 1}
				{#each availableLyrics as source (source.id)}
					<Button
						size="xs"
						variant={selectedLyrics?.id === source.id ? "default" : "ghost"}
						onclick={() => (selectedLyricsId = source.id)}
						title={source.title ?? source.label}
					>
						{source.label}
					</Button>
				{/each}
			{/if}
			<div
				class="flex flex-wrap items-center justify-end gap-1 border-l border-white/25 pl-1"
			>
				{#each [{ label: "−5s", delta: -5_000 }, { label: "−1s", delta: -1_000 }, { label: "−100ms", delta: -100 }] as adjustment (adjustment.delta)}
					<Button
						size="xs"
						variant="ghost"
						aria-label={`Show lyrics ${Math.abs(adjustment.delta)} milliseconds earlier`}
						onclick={() => nudgeLyrics(adjustment.delta)}
					>
						{adjustment.label}
					</Button>
				{/each}
				<Input
					class="h-6 w-20 border-white/25 bg-black/30 px-1 text-center text-xs text-white"
					type="number"
					step="100"
					min="-30000"
					max="30000"
					value={lyricsOffsetMs}
					oninput={(event) =>
						setLyricsOffset(event.currentTarget.valueAsNumber)}
					aria-label="Lyrics offset in milliseconds"
					title="Lyrics offset in milliseconds; positive values delay the lyrics"
				/>
				<span class="pr-0.5 text-[10px] text-white/70">ms</span>
				{#each [{ label: "+100ms", delta: 100 }, { label: "+1s", delta: 1_000 }, { label: "+5s", delta: 5_000 }] as adjustment (adjustment.delta)}
					<Button
						size="xs"
						variant="ghost"
						aria-label={`Show lyrics ${adjustment.delta} milliseconds later`}
						onclick={() => nudgeLyrics(adjustment.delta)}
					>
						{adjustment.label}
					</Button>
				{/each}
			</div>
		</div>
	{/if}
	<!-- svelte-ignore a11y_media_has_caption: a WebVTT fallback is included when available -->
	<video
		bind:this={video}
		class="aspect-video w-full"
		controls
		preload="metadata"
		{src}
		aria-label={title ? `Karaoke video: ${title}` : "Karaoke video"}
		onloadedmetadata={updateTime}
		ontimeupdate={updateTime}
		onseeked={updateTime}
		onplay={startTracking}
		onpause={stopTracking}
		onended={stopTracking}
	>
		{#if captionsUrl}
			<track
				default={availableLyrics.length === 0}
				kind="captions"
				src={captionsUrl}
				label="Lyrics"
			/>
		{/if}
	</video>

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
