<script lang="ts">
	import { buttonVariants } from "#lib/components/ui/button/index.js";
	import type { OnlineTimingObject } from "#lib/timing/index.js";
	import { cn } from "#lib/utils.js";
	import { Maximize, Minimize, Minus, Pause, Play, Plus, RotateCcw, SkipForward } from "@lucide/svelte";

	let {
		timing,
		canControl,
		onSkip,
		fullscreen = false,
		onToggleFullscreen,
		onTranspose,
		transposeSemitones = 0,
		appliedSemitones = 0,
		transposeDisabled = false,
	}: {
		timing?: OnlineTimingObject;
		canControl: boolean;
		onSkip?: () => void;
		fullscreen?: boolean;
		onToggleFullscreen?: () => void;
		onTranspose?: (semitones: number) => void;
		transposeSemitones?: number;
		appliedSemitones?: number;
		transposeDisabled?: boolean;
	} = $props();

	const controlsReady = $derived(!timing || timing.readyState === "open");
</script>

{#if canControl}
	<media-controls
		class="invisible pointer-events-none absolute inset-0 z-30 block opacity-0 transition-[opacity,visibility] duration-200 data-[visible]:visible data-[visible]:opacity-100"
		hideDelay={3000}
	>
		<media-controls-group class="absolute inset-x-0 bottom-0 block">
			{#if onTranspose}
				<div class="flex items-center justify-end gap-1 border-b border-white/15 bg-zinc-950/95 px-3 py-1 text-white" role="group" aria-label="Song key">
					<button type="button"
						class={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-white hover:bg-white/15 hover:text-white")}
						disabled={!controlsReady || transposeDisabled || transposeSemitones <= -6}
						onclick={() => onTranspose?.(transposeSemitones - 1)}
						aria-label="Lower key one semitone" title="Lower key one semitone">
						<Minus />
					</button>
					<output class="w-14 text-center text-xs tabular-nums" aria-label="Current transposition" aria-live="polite">
						{appliedSemitones === 0 ? "Original" : `${appliedSemitones > 0 ? "+" : ""}${appliedSemitones}`}
					</output>
					<button type="button"
						class={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-white hover:bg-white/15 hover:text-white")}
						disabled={!controlsReady || transposeDisabled || transposeSemitones >= 6}
						onclick={() => onTranspose?.(transposeSemitones + 1)}
						aria-label="Raise key one semitone" title="Raise key one semitone">
						<Plus />
					</button>
					<button type="button"
						class={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-white hover:bg-white/15 hover:text-white")}
						disabled={!controlsReady || transposeSemitones === 0}
						onclick={() => onTranspose?.(0)}
						aria-label="Reset to original key" title="Reset to original key">
						<RotateCcw />
					</button>
				</div>
			{/if}
			<div class="flex items-center gap-2 bg-zinc-950/95 px-3 py-2 text-white">
				<media-play-button
					class={cn(
						buttonVariants({ variant: "ghost", size: "icon" }),
						"group text-white hover:bg-white/15 hover:text-white",
					)}
					disabled={!controlsReady}
				>
					<Play
						class="hidden group-data-[ended]:block group-data-[paused]:block"
					/>
					<Pause
						class="group-data-[ended]:hidden group-data-[paused]:hidden"
					/>
				</media-play-button>

				{#if onSkip}
					<button
						type="button"
						class={cn(
							buttonVariants({ variant: "ghost", size: "icon" }),
							"text-white hover:bg-white/15 hover:text-white",
						)}
						disabled={!controlsReady}
						onclick={onSkip}
						aria-label="Skip to next song"
						title="Skip to next song"
					>
						<SkipForward />
					</button>
				{/if}

				<media-time
					type="current"
					class="w-10 text-right text-xs tabular-nums"
				></media-time>

				<media-time-slider
					class="group relative flex h-5 min-w-0 flex-1 cursor-pointer touch-none items-center outline-none data-[focus]:ring-3 data-[focus]:ring-ring/30"
					disabled={!controlsReady}
					pauseWhileDragging={false}
				>
					<div
						class="relative h-1.5 w-full overflow-hidden rounded-full bg-white/25"
					>
						<div
							class="absolute inset-y-0 left-0 bg-white/20"
							style="width: var(--slider-progress)"
						></div>
						<div
							class="absolute inset-y-0 left-0 bg-primary"
							style="width: var(--slider-fill)"
						></div>
					</div>
					<div
						class="absolute size-3 rounded-full border border-primary bg-white shadow-sm transition-transform group-data-[active]:scale-125"
						style="left: var(--slider-fill); transform: translateX(-50%)"
					></div>
				</media-time-slider>

				<media-time
					type="duration"
					class="w-10 text-xs tabular-nums"
				></media-time>
				{#if onToggleFullscreen}
					<button
						type="button"
						class={cn(
							buttonVariants({ variant: "ghost", size: "icon" }),
							"shrink-0 text-white hover:bg-white/15 hover:text-white",
						)}
						onclick={onToggleFullscreen}
						aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
						title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
					>
						{#if fullscreen}
							<Minimize />
						{:else}
							<Maximize />
						{/if}
					</button>
				{/if}
			</div>
		</media-controls-group>
	</media-controls>
{/if}
