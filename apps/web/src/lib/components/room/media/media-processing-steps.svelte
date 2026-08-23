<script lang="ts">
	import { Progress } from "$lib/components/ui/progress";
	import { Timer } from "@lucide/svelte";
	import { stageLabel, statusLabel, stepTimingLabel } from "../media-format";
	import type { MediaStep } from "../types";

	let {
		steps,
		currentTime,
	}: {
		steps: ReadonlyArray<MediaStep>;
		currentTime: number;
	} = $props();
</script>

<ul class="grid gap-2 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
	{#each steps as step (step.kind)}
		{@const timingLabel = stepTimingLabel(step, currentTime)}
		<li class="rounded-md border bg-muted/20 p-2.5">
			<div class="flex items-center justify-between gap-3 text-xs">
				<span class="font-medium">{step.label ?? stageLabel(step.kind)}</span>
				{#if timingLabel}
					<span class="flex items-center gap-1 tabular-nums text-muted-foreground">
						<Timer class="size-3" aria-hidden="true" />
						{timingLabel}
					</span>
				{:else}
					<span class="text-muted-foreground">{statusLabel(step.state)}</span>
				{/if}
			</div>
			{#if step.state === "running" || step.state === "queued"}
				<div class="flex gap-2 items-center mt-2">
					<Progress
						value={step.progress * 100}
						aria-label={`${step.label ?? stageLabel(step.kind)} ${Math.round(step.progress * 100)}%`}
						class="flex-1"
					/>
					<output class="text-xs text-muted-foreground tabular-nums w-[4ch] text-end">
						{Math.round(step.progress * 100)}%
					</output>
				</div>
			{/if}
			{#if step.message && (step.state === "running" || step.state === "queued")}
				<p class="mt-1.5 truncate text-xs text-muted-foreground" title={step.message}>
					{step.message}
				</p>
			{/if}
		</li>
	{/each}
</ul>
