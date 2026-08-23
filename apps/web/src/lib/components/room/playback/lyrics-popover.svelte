<script lang="ts">
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import * as Popover from "$lib/components/ui/popover";
	import type { LyricsTrack } from "$lib/karaoke";
	import { Captions } from "@lucide/svelte";

	type Props = {
		lyrics?: LyricsTrack[];
		selectedLyricsId?: string | null;
		lyricsOffsetMs?: number;
		canControl?: boolean;
		onLyricsChange?: (lyricsId: string, offsetMs: number) => void;
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

	function setOffset(value: number) {
		if (!selectedLyrics || !canControl) return;
		const offset = Number.isFinite(value) ? value : 0;
		onLyricsChange?.(
			selectedLyrics.id,
			Math.max(-30_000, Math.min(30_000, offset)),
		);
	}

	function selectLyrics(id: string) {
		if (!canControl) return;
		const track = availableLyrics.find((candidate) => candidate.id === id);
		onLyricsChange?.(id, track?.suggestedOffsetMs ?? 0);
	}
</script>

<Popover.Root>
	<Popover.Trigger
		class={buttonVariants({ variant: "outline", size: "sm" })}
		aria-label="Configure lyrics"
	>
		<Captions aria-hidden="true" />
		Lyrics
	</Popover.Trigger>
	<Popover.Content align="end" class="w-80 gap-4 rounded-xl p-4">
		<Popover.Header class="gap-1">
			<Popover.Title>Lyrics</Popover.Title>
			<Popover.Description>
				Choose a lyrics track and adjust its timing.
			</Popover.Description>
		</Popover.Header>

		{#if availableLyrics.length > 1}
			<div class="space-y-2">
				<p class="text-xs font-medium text-muted-foreground">Track</p>
				<div class="flex flex-wrap gap-1.5">
					{#each availableLyrics as source (source.id)}
						<Button
							size="sm"
							variant={selectedLyrics?.id === source.id ? "default" : "outline"}
							disabled={!canControl}
							onclick={() => selectLyrics(source.id)}
							title={source.title ?? source.label}
						>
							{source.label}
						</Button>
					{/each}
				</div>
			</div>
		{/if}

		<div class="space-y-2">
			<div>
				<p class="text-xs font-medium text-muted-foreground">Offset</p>
				<p class="text-xs text-muted-foreground">
					Negative values show lyrics earlier; positive values show them later.
				</p>
			</div>
			<div class="grid grid-cols-3 gap-1.5">
				{#each [{ label: "−5s", delta: -5_000 }, { label: "−1s", delta: -1_000 }, { label: "−100ms", delta: -100 }] as adjustment (adjustment.delta)}
					<Button
						size="sm"
						variant="outline"
						disabled={!canControl}
						onclick={() => setOffset(offsetMs + adjustment.delta)}
						aria-label={`Show lyrics ${Math.abs(adjustment.delta)} milliseconds earlier`}
					>
						{adjustment.label}
					</Button>
				{/each}
			</div>
			<div class="relative">
				<Input
					class="pr-8 text-right tabular-nums"
					type="number"
					step="100"
					min="-30000"
					max="30000"
					value={offsetMs}
					disabled={!canControl}
					onchange={(event) => setOffset(event.currentTarget.valueAsNumber)}
					aria-label="Lyrics offset in milliseconds"
				/>
				<span
					class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground"
					>ms</span
				>
			</div>
			<div class="grid grid-cols-3 gap-1.5">
				{#each [{ label: "+100ms", delta: 100 }, { label: "+1s", delta: 1_000 }, { label: "+5s", delta: 5_000 }] as adjustment (adjustment.delta)}
					<Button
						size="sm"
						variant="outline"
						disabled={!canControl}
						onclick={() => setOffset(offsetMs + adjustment.delta)}
						aria-label={`Show lyrics ${adjustment.delta} milliseconds later`}
					>
						{adjustment.label}
					</Button>
				{/each}
			</div>
		</div>
	</Popover.Content>
</Popover.Root>
