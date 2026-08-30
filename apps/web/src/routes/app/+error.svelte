<script lang="ts">
	import { page } from "$app/state";
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
	import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
</script>

<svelte:head>
	<title>Something went wrong · Partyroom</title>
</svelte:head>

<div class="bg-muted/30 flex min-h-svh items-center justify-center p-6">
	<Card.Root class="w-full max-w-lg">
		<Card.Header class="gap-4">
			<div class="flex items-center gap-2">
				<div
					class="bg-destructive/10 text-destructive flex size-11 items-center justify-center rounded-full"
					aria-hidden="true"
				>
					<CircleAlertIcon class="size-5" />
				</div>
				<p class="text-destructive font-mono text-sm">
					{page.status}
				</p>
			</div>
			<div class="space-y-1.5">
				<Card.Title class="text-xl">Something went wrong</Card.Title>
				<Card.Description class="text-pretty">
					We couldn't open that page. Head back to your room list and try again.
				</Card.Description>
			</div>
		</Card.Header>

		{#if page.error?.message}
			<Card.Content>
				<p
					class="border-destructive/20 bg-destructive/5 text-destructive rounded-xl border p-3 text-xs font-mono"
					role="alert"
				>
					{page.error.message}
				</p>
			</Card.Content>
		{/if}

		<Card.Footer class="justify-end">
			<Button href="/app">
				<ArrowLeftIcon />
				Back to rooms
			</Button>
		</Card.Footer>
	</Card.Root>
</div>
