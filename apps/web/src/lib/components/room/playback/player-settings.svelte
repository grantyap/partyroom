<script lang="ts">
	import { Button, buttonVariants } from "#lib/components/ui/button/index.js";
	import * as Popover from "#lib/components/ui/popover/index.js";
	import * as Sheet from "#lib/components/ui/sheet/index.js";
	import { IsMobile } from "#lib/hooks/is-mobile.svelte.js";
	import type { LyricsTrack } from "#lib/karaoke.js";
	import { cn } from "#lib/utils.js";
	import { ArrowLeft, Check, ChevronRight, Settings } from "@lucide/svelte";
	import { tick } from "svelte";
	import LyricsSettings from "./lyrics-settings.svelte";

	let {
		canControl,
		controlsReady,
		transposeSemitones = 0,
		appliedSemitones = 0,
		transposeDisabled = false,
		transposeError,
		onTranspose,
		lyrics = [],
		selectedLyricsId,
		lyricsOffsetMs,
		onLyricsChange,
		portalTarget,
		currentKey,
		onOpenChange,
	}: {
		canControl: boolean;
		controlsReady: boolean;
		transposeSemitones?: number;
		appliedSemitones?: number;
		transposeDisabled?: boolean;
		transposeError?: string | null;
		onTranspose?: (semitones: number) => void;
		lyrics?: LyricsTrack[];
		selectedLyricsId?: string | null;
		lyricsOffsetMs?: number;
		onLyricsChange?: (lyricsId: string, offsetMs: number) => void | Promise<void>;
		portalTarget?: Element;
		currentKey?: string;
		onOpenChange?: (open: boolean) => void;
	} = $props();

	const mobile = new IsMobile();
	let open = $state(false);
	type Section = "main" | "key" | "source" | "delay";
	let section = $state<Section>("main");
	let heading = $state<HTMLHeadingElement>();
	let trigger = $state<HTMLButtonElement | null>(null);
	let keyRow = $state<HTMLButtonElement | null>(null);
	let sourceRow = $state<HTMLButtonElement | null>(null);
	let delayRow = $state<HTMLButtonElement | null>(null);
	let selectedKey = $state(0);
	const keyGroup = $props.id();
	const keys = Array.from({ length: 13 }, (_, index) => index - 6);
	const sectionTitle = $derived(section === "key" ? "Song key" : section === "source" ? "Lyrics source" : "Lyrics delay");
	const rowClass = "h-auto min-h-11 w-full justify-start gap-3 rounded-none px-4 py-2";
	const availableLyrics = $derived(lyrics.filter(({ content }) =>
		content.kind === "url" ? content.url.length > 0 : content.observations.length > 0));
	const selectedLyrics = $derived(availableLyrics.find(({ id }) => id === selectedLyricsId) ?? availableLyrics[0]);
	const delay = $derived(lyricsOffsetMs ?? selectedLyrics?.suggestedOffsetMs ?? 0);
	const keySummary = $derived(appliedSemitones === 0 ? "Original" :
		`${appliedSemitones > 0 ? "+" : ""}${appliedSemitones} ${Math.abs(appliedSemitones) === 1 ? "semitone" : "semitones"}`);
	const disabled = $derived(!canControl || !controlsReady);
	const triggerClass = cn(
		buttonVariants({ variant: "ghost", size: "icon" }),
		"shrink-0 text-white hover:bg-white/15 hover:text-white aria-expanded:bg-white/15 aria-expanded:text-white",
	);
	$effect(() => {
		currentKey;
		open = false;
	});
	$effect(() => {
		onOpenChange?.(open);
	});
	$effect(() => {
		if (!open) section = "main";
	});
	$effect(() => {
		// Restore the confirmed selection after a failed request or readiness change.
		transposeDisabled;
		transposeError;
		selectedKey = transposeSemitones;
	});

	async function enterSection(next: Exclude<Section, "main">) {
		section = next;
		await tick();
		if (open && section === next) heading?.focus();
	}

	async function goBack() {
		const previous = section;
		section = "main";
		await tick();
		if (open && section === "main") (previous === "key" ? keyRow : previous === "source" ? sourceRow : delayRow)?.focus();
	}

	function restoreTriggerFocus(event: Event) {
		event.preventDefault();
		trigger?.focus();
	}
</script>

{#snippet fields()}
	<div>
		<div hidden={section !== "main"} class="py-1">
			{#if onTranspose}
				<Button bind:ref={keyRow} variant="ghost" class={rowClass} onclick={() => void enterSection("key")}>
					<span class="font-medium">Song key</span>
					<span class="min-w-0 flex-1 text-right text-xs text-muted-foreground">{keySummary}</span>
					<ChevronRight />
				</Button>
			{/if}
			<Button bind:ref={sourceRow} variant="ghost" class={rowClass} onclick={() => void enterSection("source")}>
				<span class="font-medium">Lyrics source</span>
				<span class="min-w-0 flex-1 truncate text-right text-xs font-normal text-muted-foreground">{selectedLyrics?.label ?? "Unavailable"}</span>
				<ChevronRight />
			</Button>
			<Button bind:ref={delayRow} variant="ghost" class={rowClass} onclick={() => void enterSection("delay")}>
				<span class="font-medium">Lyrics delay</span>
				<span class="min-w-0 flex-1 text-right text-xs font-normal tabular-nums text-muted-foreground">{delay === 0 ? "None" : `${delay > 0 ? "+" : ""}${delay / 1000}s`}</span>
				<ChevronRight />
			</Button>
		</div>
		{#if section !== "main"}
			<div class="sticky top-0 z-10 flex items-center gap-1 border-b bg-popover px-2 py-1" class:pr-12={mobile.current}>
				<Button variant="ghost" size="icon" class="rounded-md" onclick={() => void goBack()} aria-label="Back to player settings" title="Back to player settings"><ArrowLeft /></Button>
				<h3 bind:this={heading} tabindex="-1" class="text-sm font-semibold outline-none">{sectionTitle}</h3>
			</div>
		{/if}
		{#if onTranspose}
			<section hidden={section !== "key"} aria-label="Song key settings">
				<fieldset class="min-w-0 py-1" disabled={disabled}>
					<legend class="sr-only">Song key</legend>
					{#each keys as semitones}
						<label class="block cursor-pointer has-disabled:cursor-default">
							<input class="peer sr-only" type="radio" name={keyGroup} value={semitones} bind:group={selectedKey} disabled={transposeDisabled && semitones !== 0} onchange={() => onTranspose?.(semitones)} />
							<span class="flex min-h-11 items-center gap-3 px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-ring">
								<Check class={`size-4 shrink-0 ${selectedKey === semitones ? "" : "invisible"}`} />
								{semitones === 0 ? "Original" : `${semitones > 0 ? "+" : ""}${semitones} ${Math.abs(semitones) === 1 ? "semitone" : "semitones"}`}
							</span>
						</label>
					{/each}
				</fieldset>
				{#if transposeError}<p class="px-4 pb-3 text-xs text-destructive" role="alert">{transposeError}</p>{/if}
			</section>
		{/if}
		<!-- Keep queued lyrics saves alive when navigating back to the main panel. -->
		<div hidden={section !== "source" && section !== "delay"}>
			{#key currentKey}
				<LyricsSettings view={section === "source" ? "source" : "delay"} {lyrics} {selectedLyricsId} {lyricsOffsetMs} canControl={canControl && controlsReady} {onLyricsChange} />
			{/key}
		</div>
	</div>
{/snippet}

{#snippet scope()}
	<span>Shared with the room</span>
	{#if !canControl}<span class="rounded border px-1.5 py-0.5 text-[.625rem] font-medium">Read-only</span>{/if}
{/snippet}

{#if mobile.current}
	<Sheet.Root bind:open>
		<Sheet.Trigger bind:ref={trigger} class={triggerClass} aria-label="Player settings" title="Player settings"><Settings /></Sheet.Trigger>
		<Sheet.Content side="bottom" onCloseAutoFocus={restoreTriggerFocus} portalProps={{ to: portalTarget }} class="dark scheme-dark z-[60] max-h-[85dvh] gap-0 overflow-y-auto rounded-t-lg p-0 pb-[max(.5rem,env(safe-area-inset-bottom))] [&_[data-slot=sheet-close]]:top-2 [&_[data-slot=sheet-close]]:right-2 [&_[data-slot=sheet-close]]:z-20">
			<Sheet.Header class={section === "main" ? "border-b p-3 pr-14 text-left" : "sr-only"}>
				<Sheet.Title class="font-sans text-sm">Settings</Sheet.Title>
				<Sheet.Description class="sr-only">{@render scope()}</Sheet.Description>
			</Sheet.Header>
			{@render fields()}
			{#if !canControl}<p class="border-t px-4 py-2 text-xs text-muted-foreground">Read-only</p>{/if}
		</Sheet.Content>
	</Sheet.Root>
{:else}
	<Popover.Root bind:open>
		<Popover.Trigger bind:ref={trigger} class={triggerClass} aria-label="Player settings" title="Player settings"><Settings /></Popover.Trigger>
		<Popover.Content aria-label="Player settings" side="top" align="end" sideOffset={12} collisionPadding={16} portalProps={{ to: portalTarget }} class="dark scheme-dark z-[60] w-80 max-w-[calc(100vw-2rem)] max-h-[min(24rem,var(--bits-popover-content-available-height,calc(100dvh-2rem)))] gap-0 overflow-y-auto rounded-lg p-0">
			<Popover.Header class="sr-only">
				<Popover.Title>Player settings</Popover.Title>
				<Popover.Description>{@render scope()}</Popover.Description>
			</Popover.Header>
			{@render fields()}
			{#if !canControl}<p class="border-t px-4 py-2 text-xs text-muted-foreground">Read-only</p>{/if}
		</Popover.Content>
	</Popover.Root>
{/if}
