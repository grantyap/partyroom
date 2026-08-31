<!--
@component
Consumers can style the current line with `[data-lyric-line="current"]`. In
word-timed lyrics, each word also receives `data-lyric-word="upcoming"`,
"current", or "complete" while its line is current.
-->
<script lang="ts">
	import { karaokeWordProgress, type KaraokeCue } from "$lib/karaoke";

	type KaraokeWordState = "upcoming" | "current" | "complete";

	let {
		cue,
		currentTime,
		wordTiming,
		wordProgress = false,
		active = true,
		class: className = "",
	}: {
		cue: KaraokeCue;
		currentTime: number;
		wordTiming: boolean;
		wordProgress?: boolean;
		active?: boolean;
		class?: string;
	} = $props();

	function wordState(
		word: KaraokeCue["words"][number],
	): KaraokeWordState | undefined {
		if (!active || !wordTiming) return undefined;
		if (currentTime < word.time) return "upcoming";
		if (currentTime >= word.time + word.duration) return "complete";
		return "current";
	}
</script>

<p
	class={className}
	data-lyric-line={active ? "current" : undefined}
	data-lyric-timing={wordTiming ? "word" : "line"}
	aria-current={active ? "true" : undefined}
>
	{#each cue.words as word, index (`${word.time}-${index}`)}
		{@const state = wordState(word)}
		<span
			data-lyric-word={state}
			style={active && wordTiming && wordProgress
				? `--karaoke-progress: ${karaokeWordProgress(word, currentTime) * 100}%`
				: undefined}>{word.text}</span
		>
	{/each}
</p>
