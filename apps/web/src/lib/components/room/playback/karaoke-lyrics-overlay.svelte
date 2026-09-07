<script lang="ts">
	import type { KaraokeCue } from "$lib/karaoke";
	import KaraokeLyricLine from "./karaoke-lyric-line.svelte";

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
	class="pointer-events-none absolute inset-0 flex flex-col justify-end bg-linear-to-t from-black/80 via-black/25 to-transparent px-4 pb-12 text-center sm:px-8 sm:pb-14"
	aria-hidden="true"
>
	<KaraokeLyricLine
		cue={activeCue}
		currentTime={adjustedTime}
		{wordTiming}
		wordProgress={true}
		class="text-[clamp(1.125rem,3.4vw,2rem)] font-extrabold leading-[1.2] tracking-[-0.025em] [text-wrap:balance] [&[data-lyric-line=current][data-lyric-timing=line]]:text-[oklch(0.83_0.18_85)] [&>span]:inline [&>span]:me-[0.28em] [&>span:last-child]:me-0 [&>span]:[filter:drop-shadow(0_1px_1px_rgb(0_0_0_/_95%))_drop-shadow(0_2px_4px_rgb(0_0_0_/_70%))] [&[data-lyric-timing=word]>span[data-lyric-word]]:text-transparent [&[data-lyric-timing=word]>span[data-lyric-word]]:bg-[linear-gradient(90deg,oklch(0.83_0.18_85)_0%,oklch(0.83_0.18_85)_var(--karaoke-progress),rgb(255_255_255_/_58%)_var(--karaoke-progress),rgb(255_255_255_/_58%)_100%)] [&[data-lyric-timing=word]>span[data-lyric-word]]:bg-clip-text [&[data-lyric-timing=word]>span[data-lyric-word]]:[-webkit-background-clip:text]"
	/>
	{#if nextCue}
		<p
			class="mt-1 text-sm font-semibold text-white/55 drop-shadow-md sm:mt-2 sm:text-xl"
		>
			{nextCue.words.map((word) => word.text).join(" ")}
		</p>
	{/if}
</div>
