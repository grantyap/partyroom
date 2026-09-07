<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
	import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";

	let {
		status,
		title = "Something went wrong",
		description = "We couldn't open that page. Head back to your room list and try again.",
		message,
		backHref = "/app",
		backLabel = "Back to rooms",
		onRetry,
		fullPage = false,
	}: {
		status?: number | string;
		title?: string;
		description?: string;
		message?: string | null;
		backHref?: string | null;
		backLabel?: string;
		onRetry?: () => void;
		fullPage?: boolean;
	} = $props();

	const containerClass = $derived(
		fullPage
			? "bg-muted/30 flex min-h-svh items-center justify-center p-6"
			: "mx-auto flex min-h-[50dvh] w-full items-center justify-center p-6",
	);
</script>

<div class={containerClass}>
	<Card.Root class="w-full max-w-lg">
		<Card.Header class="gap-4">
			<div class="flex items-center gap-2">
				<div
					class="bg-destructive/10 text-destructive flex size-11 items-center justify-center rounded-full"
					aria-hidden="true"
				>
					<CircleAlertIcon class="size-5" />
				</div>
				{#if status !== undefined}
					<p class="text-destructive font-mono text-sm">
						{status}
					</p>
				{/if}
			</div>
			<div class="space-y-1.5">
				<Card.Title class="text-xl">{title}</Card.Title>
				<Card.Description class="text-pretty">
					{description}
				</Card.Description>
			</div>
		</Card.Header>

		{#if message}
			<Card.Content>
				<p
					class="border-destructive/20 bg-destructive/5 text-destructive rounded-xl border p-3 text-xs font-mono"
					role="alert"
				>
					{message}
				</p>
			</Card.Content>
		{/if}

		<Card.Footer class={onRetry ? "justify-between gap-3" : "justify-end"}>
			{#if onRetry}
				<Button variant="outline" onclick={onRetry}>Try again</Button>
			{/if}
			{#if backHref}
				<Button href={backHref}>
					<ArrowLeftIcon />
					{backLabel}
				</Button>
			{/if}
		</Card.Footer>
	</Card.Root>
</div>
