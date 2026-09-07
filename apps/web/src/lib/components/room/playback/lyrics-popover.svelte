<script lang="ts">
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import * as Popover from "$lib/components/ui/popover";
	import { onDestroy } from "svelte";
	import type { LyricsTrack } from "$lib/karaoke";
	import { Settings2, RotateCcw } from "@lucide/svelte";

	type Props = {
		lyrics?: LyricsTrack[];
		selectedLyricsId?: string | null;
		lyricsOffsetMs?: number;
		canControl?: boolean;
		onLyricsChange?: (lyricsId: string, offsetMs: number) => void | Promise<void>;
	};

	let {
		lyrics = [],
		selectedLyricsId,
		lyricsOffsetMs,
		canControl = false,
		onLyricsChange,
	}: Props = $props();

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
	const offsetMs = $derived(
		lyricsOffsetMs ?? selectedLyrics?.suggestedOffsetMs ?? 0,
	);

	type LyricsEdit = { lyricsId: string; offsetMs: number };
	let optimistic = $state<LyricsEdit | null>(null);
	let queued: LyricsEdit | null = null;
	onDestroy(() => { queued = null; });
	let saving = $state(false);
	let error = $state<string | null>(null);
	const inputLyricsId = $derived(optimistic?.lyricsId ?? selectedLyrics?.id);
	const inputOffsetMs = $derived(optimistic?.offsetMs ?? offsetMs);
	const disabled = $derived(!canControl || !selectedLyrics);

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
		optimistic = {
			lyricsId,
			offsetMs: Math.max(-30_000, Math.min(30_000, Math.round(offset))),
		};
		queued = optimistic;
		void flushChanges();
	}

	function setOffset(value: number) {
		if (inputLyricsId) save(inputLyricsId, value);
	}

	function selectLyrics(id: string) {
		const track = availableLyrics.find((candidate) => candidate.id === id);
		if (track) void save(id, track.suggestedOffsetMs ?? 0);
	}
</script>

<div class="flex w-full items-center justify-between gap-3">
	<p class="min-w-0 truncate text-xs text-muted-foreground">
		{selectedLyrics?.label ?? "No source"}
		<span class="mx-1" aria-hidden="true">·</span>
		<span class="tabular-nums">{offsetMs === 0 ? "No delay" : `${offsetMs > 0 ? "+" : ""}${offsetMs / 1000}s delay`}</span>
	</p>
	<Popover.Root>
		<Popover.Trigger
			class={buttonVariants({
				variant: "ghost",
				size: "sm",
				class: "shrink-0 text-xs",
			})}
			aria-label="Lyrics settings"
		>
			<Settings2 aria-hidden="true" /> Settings
		</Popover.Trigger>
		<Popover.Content align="end" class="w-80 max-w-[calc(100vw-2rem)] gap-4 rounded-xl p-4" aria-busy={saving}>
			<Popover.Header class="gap-1">
				<Popover.Title>Lyrics settings</Popover.Title>
				<Popover.Description>Changes apply to everyone in the room.</Popover.Description>
			</Popover.Header>
			<div class="space-y-2">
				<p class="text-xs font-medium">Source</p>
				<div class="flex flex-col gap-2">
					{#each availableLyrics as source (source.id)}
						<Button
							class="justify-start"
							variant={inputLyricsId === source.id ? "default" : "outline"}
							{disabled}
							aria-pressed={inputLyricsId === source.id}
							onclick={() => selectLyrics(source.id)}
							title={source.title ?? source.label}
						>{source.label}</Button>
					{/each}
				</div>
				{#if availableLyrics.length === 1}
					<p class="text-xs text-muted-foreground">Only one source is available for this song.</p>
				{/if}
			</div>
			<div class="space-y-2 border-t pt-3">
				<p class="text-xs font-medium">Timing</p>
	<div class="flex items-center gap-1.5">
		<Button size="icon" variant="outline" disabled={disabled || inputOffsetMs <= -30_000}
			onclick={() => setOffset(inputOffsetMs - 100)} aria-label="Show lyrics 100 milliseconds earlier">−</Button>
		<div class="relative min-w-0 flex-1">
			<Input class="pr-9 text-center tabular-nums" type="number" step="0.1" min="-30" max="30"
				value={inputOffsetMs / 1000} {disabled}
				onchange={(event) => setOffset(event.currentTarget.valueAsNumber * 1000)}
				aria-label="Lyrics delay in seconds" />
			<span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">s</span>
		</div>
		<Button size="icon" variant="outline" disabled={disabled || inputOffsetMs >= 30_000}
			onclick={() => setOffset(inputOffsetMs + 100)} aria-label="Show lyrics 100 milliseconds later">+</Button>
		<Button size="icon" variant="ghost" disabled={disabled || inputOffsetMs === 0}
			onclick={() => setOffset(0)} aria-label="Reset lyrics delay" title="Reset delay">
			<RotateCcw aria-hidden="true" class="size-4" />
		</Button>
	</div>
	<p class="text-xs leading-relaxed text-muted-foreground">
		{#if canControl}
			− Earlier · + Later · Adjusts for everyone
		{:else}
			Requires the room’s Control playback permission.
		{/if}
	</p>
	{#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
			</div>
		</Popover.Content>
	</Popover.Root>
</div>
