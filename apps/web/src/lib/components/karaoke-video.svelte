<script lang="ts">
	import {
		findKaraokeCue,
		groupLyricsIntoCues,
		karaokeWordProgress,
		parseLyricObservations,
		type KaraokeCue,
	} from "$lib/karaoke";

	type Props = {
		src: string;
		timedLyricsUrl?: string | null;
		annotationsUrl?: string | null;
		captionsUrl?: string | null;
		title?: string | null;
		class?: string;
	};

	let {
		src,
		timedLyricsUrl,
		annotationsUrl,
		captionsUrl,
		title,
		class: className = "",
	}: Props = $props();

	let video = $state<HTMLVideoElement>();
	let currentTime = $state(0);
	let cues = $state<KaraokeCue[]>([]);
	let animationFrame: number | undefined;

	const activeCueIndex = $derived(findKaraokeCue(cues, currentTime));
	const activeCue = $derived(
		activeCueIndex >= 0 ? cues[activeCueIndex] : undefined,
	);
	const nextCue = $derived(
		activeCueIndex >= 0 ? cues[activeCueIndex + 1] : undefined,
	);

	$effect(() => {
		const url = timedLyricsUrl ?? annotationsUrl;
		cues = [];
		if (!url) return;

		const controller = new AbortController();
		void fetch(url, { signal: controller.signal })
			.then((response) => {
				if (!response.ok)
					throw new Error(`Unable to load lyrics: HTTP ${response.status}`);
				return response.json();
			})
			.then((document: unknown) => {
				cues = groupLyricsIntoCues(parseLyricObservations(document));
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

	$effect(() => () => {
		if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
	});
</script>

<div class={`relative overflow-hidden rounded-md bg-black ${className}`}>
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
				default={!timedLyricsUrl && !annotationsUrl}
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
						style={`--karaoke-progress: ${karaokeWordProgress(word, currentTime) * 100}%`}
						>{word.text}</span
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
		--karaoke-progress: 0%;
		display: inline;
		margin-inline-end: 0.28em;
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
		filter: drop-shadow(0 1px 1px rgb(0 0 0 / 95%))
			drop-shadow(0 2px 4px rgb(0 0 0 / 70%));
	}

	.karaoke-word:last-child {
		margin-inline-end: 0;
	}
</style>
