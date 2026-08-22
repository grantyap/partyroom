<script lang="ts">
	import { buttonVariants } from "$lib/components/ui/button";
	import * as Popover from "$lib/components/ui/popover";
	import { Progress } from "$lib/components/ui/progress";
	import { Check, Circle, LoaderCircle, Timer, X } from "@lucide/svelte";
	import { onMount } from "svelte";

	type MediaStep = {
		kind: string;
		label?: string;
		state: string;
		progress: number;
		message?: string;
		startedAt?: number;
		completedAt?: number;
	};

	let {
		title,
		steps,
	}: {
		title: string;
		steps: ReadonlyArray<MediaStep>;
	} = $props();

	let currentTime = $state(Date.now());

	const overallProgress = $derived.by(() => {
		if (steps.length === 0) return 0;
		const completedProgress = steps.reduce((total, step) => {
			if (step.state === "completed" || step.state === "skipped") return total + 1;
			return total + Math.min(1, Math.max(0, step.progress));
		}, 0);
		return Math.round((completedProgress / steps.length) * 100);
	});

	const activeStep = $derived(
		steps.find((step) => step.state === "running") ??
			steps.find((step) => step.state === "queued"),
	);

	onMount(() => {
		const timer = window.setInterval(() => {
			currentTime = Date.now();
		}, 1_000);
		return () => window.clearInterval(timer);
	});

	function stageLabel(stage: string) {
		const labels: Record<string, string> = {
			resolve: "Resolve source",
			fetchLyrics: "Fetch synced lyrics",
			download: "Download source",
			extractAudio: "Extract audio",
			separate: "Separate stems",
			transcribe: "Transcribe lyrics",
			alignLyrics: "Align LRCLIB lyrics",
			analyzeMelody: "Analyze melody",
			mux: "Build final video",
			assembleAnnotations: "Assemble annotations",
		};
		return (
			labels[stage] ??
			stage
				.replace(/([A-Z])/g, " $1")
				.replace(/^./, (letter) => letter.toUpperCase())
		);
	}

	function statusLabel(status: string) {
		if (status === "running") return "Working";
		if (status === "queued") return "Queued";
		if (status === "completed") return "Done";
		if (status === "failed") return "Unavailable";
		if (status === "canceled") return "Canceled";
		if (status === "skipped") return "Not needed";
		return "Waiting";
	}

	function formatElapsed(milliseconds: number) {
		const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
	}

	function stepTimingLabel(step: MediaStep) {
		if (step.startedAt === undefined) return null;
		const elapsed = formatElapsed((step.completedAt ?? currentTime) - step.startedAt);
		if (step.state === "completed") return `Completed in ${elapsed}`;
		if (step.state === "failed") return `Stopped after ${elapsed}`;
		if (step.state === "running") return elapsed;
		return null;
	}

	function totalElapsed() {
		const startedSteps = steps.filter(
			(step): step is MediaStep & { startedAt: number } => step.startedAt !== undefined,
		);
		if (startedSteps.length === 0) return null;
		const startedAt = Math.min(...startedSteps.map((step) => step.startedAt));
		return formatElapsed(currentTime - startedAt);
	}
</script>

<Popover.Root>
	<Popover.Trigger
		class={buttonVariants({ variant: "secondary", size: "xs" })}
		aria-label={`View processing progress for ${title}`}
		title="View processing progress"
	>
		<LoaderCircle class="animate-spin" aria-hidden="true" />
		<span class="tabular-nums">{overallProgress}%</span>
	</Popover.Trigger>
	<Popover.Content align="end" class="w-80 gap-3 rounded-xl p-3 sm:w-96">
		<Popover.Header class="gap-1">
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<Popover.Title class="truncate">{title}</Popover.Title>
					<Popover.Description>
						{activeStep ? (activeStep.label ?? stageLabel(activeStep.kind)) : "Preparing media"}
					</Popover.Description>
				</div>
				{#if totalElapsed()}
					<span class="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
						<Timer class="size-3" aria-hidden="true" />
						{totalElapsed()}
					</span>
				{/if}
			</div>
		</Popover.Header>

		<div class="flex items-center gap-2">
			<Progress value={overallProgress} aria-label={`Overall processing progress ${overallProgress}%`} class="h-2 flex-1" />
			<output class="w-9 text-end text-xs tabular-nums text-muted-foreground">{overallProgress}%</output>
		</div>

		<ul class="max-h-72 space-y-2 overflow-y-auto pr-1">
			{#each steps as step (step.kind)}
				{@const timing = stepTimingLabel(step)}
				<li class="rounded-lg border bg-muted/20 p-2.5">
					<div class="flex items-center gap-2 text-xs">
						{#if step.state === "running"}
							<LoaderCircle class="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
						{:else if step.state === "completed" || step.state === "skipped"}
							<Check class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
						{:else if step.state === "failed" || step.state === "canceled"}
							<X class="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
						{:else}
							<Circle class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
						{/if}
						<span class="min-w-0 flex-1 truncate font-medium">{step.label ?? stageLabel(step.kind)}</span>
						<span class="shrink-0 tabular-nums text-muted-foreground">{timing ?? statusLabel(step.state)}</span>
					</div>
					{#if step.state === "running" || step.state === "queued"}
						<div class="mt-2 flex items-center gap-2">
							<Progress
								value={step.progress * 100}
								aria-label={`${step.label ?? stageLabel(step.kind)} ${Math.round(step.progress * 100)}%`}
								class="h-1.5 flex-1"
							/>
							<output class="w-9 text-end text-xs tabular-nums text-muted-foreground">
								{Math.round(step.progress * 100)}%
							</output>
						</div>
					{/if}
					{#if step.message && (step.state === "running" || step.state === "queued")}
						<p class="mt-1.5 truncate text-xs text-muted-foreground" title={step.message}>{step.message}</p>
					{/if}
				</li>
			{/each}
		</ul>
	</Popover.Content>
</Popover.Root>
