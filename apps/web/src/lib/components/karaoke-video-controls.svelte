<script lang="ts">
	import { buttonVariants } from "$lib/components/ui/button";
	import type { OnlineTimingObject } from "$lib/online-timing-object.svelte";
	import { cn } from "$lib/utils";
	import { Pause, Play } from "@lucide/svelte";

	let {
		timing,
		canControl,
	}: {
		timing?: OnlineTimingObject;
		canControl: boolean;
	} = $props();

	const controlsReady = $derived(!timing || timing.readyState === "open");
</script>

{#if canControl}
	<div class="flex items-center gap-3 bg-zinc-950 px-3 py-2 text-white">
		<media-play-button
			class={cn(
				buttonVariants({ variant: "ghost", size: "icon" }),
				"group text-white hover:bg-white/15 hover:text-white",
			)}
			disabled={!controlsReady}
		>
			<Play class="hidden group-data-[ended]:block group-data-[paused]:block" />
			<Pause class="group-data-[ended]:hidden group-data-[paused]:hidden" />
		</media-play-button>

		<media-time type="current" class="w-10 text-right text-xs tabular-nums"></media-time>

		<media-time-slider
			class="group relative flex h-5 min-w-0 flex-1 cursor-pointer touch-none items-center outline-none data-[focus]:ring-3 data-[focus]:ring-ring/30"
			disabled={!controlsReady}
			pauseWhileDragging={false}
		>
			<div class="relative h-1.5 w-full overflow-hidden rounded-full bg-white/25">
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

		<media-time type="duration" class="w-10 text-xs tabular-nums"></media-time>
	</div>
{/if}
