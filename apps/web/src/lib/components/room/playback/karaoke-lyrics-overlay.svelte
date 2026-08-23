<script lang="ts">
	import { karaokeWordProgress, type KaraokeCue } from "$lib/karaoke";

	let {
		activeCue,
		nextCue,
		adjustedTime,
		wordTiming,
	}: {
		activeCue: KaraokeCue;
		nextCue?: KaraokeCue;
		adjustedTime: number;
		wordTiming: boolean;
	} = $props();
</script>

<div
	class="pointer-events-none absolute inset-x-0 top-0 flex aspect-video flex-col justify-end bg-linear-to-t from-black/80 via-black/25 to-transparent px-4 pb-12 text-center sm:px-8 sm:pb-14"
	aria-hidden="true"
>
	<p class="karaoke-line">
		{#each activeCue.words as word, index (`${word.time}-${index}`)}
			<span
				class="karaoke-word"
				class:karaoke-word-progress={wordTiming}
				class:karaoke-line-active={!wordTiming}
				style={wordTiming
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
