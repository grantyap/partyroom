<script lang="ts">
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { onDestroy } from "svelte";
	import type { LyricsTrack } from "#lib/karaoke.js";
	import { Check, Minus, Plus, RotateCcw } from "@lucide/svelte";

	let { view, lyrics = [], selectedLyricsId, lyricsOffsetMs, canControl = false, onLyricsChange }: {
		view: "source" | "delay";
		lyrics?: LyricsTrack[];
		selectedLyricsId?: string | null;
		lyricsOffsetMs?: number;
		canControl?: boolean;
		onLyricsChange?: (lyricsId: string, offsetMs: number) => void | Promise<void>;
	} = $props();

	const availableLyrics = $derived(lyrics.filter(({ content }) =>
		content.kind === "url" ? content.url.length > 0 : content.observations.length > 0));
	const selectedLyrics = $derived(availableLyrics.find(({ id }) => id === selectedLyricsId) ?? availableLyrics[0]);
	const offsetMs = $derived(lyricsOffsetMs ?? selectedLyrics?.suggestedOffsetMs ?? 0);
	type LyricsEdit = { lyricsId: string; offsetMs: number };
	let optimistic = $state<LyricsEdit | null>(null);
	let queued: LyricsEdit | null = null;
	onDestroy(() => { queued = null; });
	let saving = $state(false);
	let error = $state<string | null>(null);
	const inputLyricsId = $derived(optimistic?.lyricsId ?? selectedLyrics?.id);
	const inputOffsetMs = $derived(optimistic?.offsetMs ?? offsetMs);
	const disabled = $derived(!canControl || !selectedLyrics || !onLyricsChange);
	const sourceId = $props.id();

	async function flushChanges() {
		if (saving) return;
		saving = true;
		try {
			while (queued) {
				const edit = queued;
				queued = null;
				try {
					await onLyricsChange?.(edit.lyricsId, edit.offsetMs);
				} catch {
					// A newer edit still contains the user's complete desired settings.
					if (!queued) error = "Could not update lyrics. Please try again.";
				}
			}
		} finally {
			optimistic = null;
			saving = false;
		}
	}

	function save(lyricsId: string, offset: number) {
		if (disabled || !Number.isFinite(offset)) return;
		error = null;
		optimistic = { lyricsId, offsetMs: Math.max(-30_000, Math.min(30_000, Math.round(offset))) };
		queued = optimistic;
		void flushChanges();
	}
	function setOffset(value: number) {
		if (inputLyricsId) save(inputLyricsId, value);
	}
	function selectLyrics(id: string) {
		const track = availableLyrics.find((candidate) => candidate.id === id);
		if (track) save(id, track.suggestedOffsetMs ?? 0);
	}
</script>

<section aria-label="Lyrics settings" aria-busy={saving}>
	<fieldset hidden={view !== "source"} class="min-w-0 py-1" {disabled}>
		<legend class="sr-only">Lyrics source</legend>
		{#each availableLyrics as source (source.id)}
			<label class="block cursor-pointer has-disabled:cursor-default">
				<input class="peer sr-only" type="radio" name={`${sourceId}-source`} value={source.id} checked={inputLyricsId === source.id} onchange={() => selectLyrics(source.id)} />
				<span class="flex min-h-11 items-center gap-3 px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-ring">
					<Check class={`size-4 shrink-0 ${inputLyricsId === source.id ? "" : "invisible"}`} />
					<span class="min-w-0 break-words">{source.label}</span>
				</span>
			</label>
		{/each}
		{#if !availableLyrics.length}<p class="px-4 py-3 text-sm text-muted-foreground">No lyrics available</p>{/if}
	</fieldset>
	<div hidden={view !== "delay"} class="p-4">
		<label for={`${sourceId}-delay`} class="sr-only">Lyrics delay</label>
		<div class="flex items-center gap-2">
			<Button size="icon" variant="outline" class="size-10 shrink-0 rounded-md" disabled={disabled || inputOffsetMs <= -30_000}
				onclick={() => setOffset(inputOffsetMs - 100)} aria-label="Show lyrics 100 milliseconds earlier" title="Earlier by 0.1 seconds"><Minus /></Button>
			<div class="relative min-w-0 flex-1">
				<Input id={`${sourceId}-delay`} class="rounded-md pr-9 text-center tabular-nums" type="number" step="0.1" min="-30" max="30"
					value={inputOffsetMs / 1000} {disabled} onchange={(event) => setOffset(event.currentTarget.valueAsNumber * 1000)}
					aria-label="Lyrics delay in seconds" />
				<span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">s</span>
			</div>
			<Button size="icon" variant="outline" class="size-10 shrink-0 rounded-md" disabled={disabled || inputOffsetMs >= 30_000}
				onclick={() => setOffset(inputOffsetMs + 100)} aria-label="Show lyrics 100 milliseconds later" title="Later by 0.1 seconds"><Plus /></Button>
			<Button size="icon" variant="ghost" class="size-10 shrink-0 rounded-md" disabled={disabled || inputOffsetMs === 0}
				onclick={() => setOffset(0)} aria-label="Reset lyrics delay" title="Reset delay"><RotateCcw /></Button>
		</div>
	</div>
	{#if error}<p class="px-4 pb-3 text-xs text-destructive" role="alert">{error}</p>{/if}
</section>
