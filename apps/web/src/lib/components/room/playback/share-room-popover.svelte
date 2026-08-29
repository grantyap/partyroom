<!--
@component
Displays a control for sharing the current room.

Use `<Playback.Share />` for the default button and popover. Add a `trigger`
snippet to supply your own trigger element. Apply the provided `props` to that
element so it can open the popover and remain accessible.

@example
```svelte
<Playback.Share>
  {#snippet trigger({ props })}
    <button {...props}>Invite people</button>
  {/snippet}
</Playback.Share>
```
-->
<script lang="ts" module>
	export type ShareTriggerRenderProps = {
		props: Record<string, unknown>;
	};
</script>

<script lang="ts">
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import * as Popover from "$lib/components/ui/popover";
	import { Check, Copy, Share2 } from "@lucide/svelte";
	import QRCode from "qrcode";
	import { onMount, type Snippet } from "svelte";

	let { trigger }: { trigger?: Snippet<[ShareTriggerRenderProps]> } = $props();

	let shareUrl = $state("");
	let qrCodeUrl = $state("");
	let qrError = $state(false);
	let copied = $state(false);
	let copyResetTimer: number | undefined;

	onMount(() => {
		shareUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
		return () => window.clearTimeout(copyResetTimer);
	});

	$effect(() => {
		if (!shareUrl) return;
		let cancelled = false;
		qrError = false;

		void QRCode.toDataURL(shareUrl, {
			errorCorrectionLevel: "M",
			margin: 2,
			width: 512,
			color: { dark: "#09090b", light: "#ffffff" },
		})
			.then((url) => {
				if (!cancelled) qrCodeUrl = url;
			})
			.catch(() => {
				if (!cancelled) qrError = true;
			});

		return () => {
			cancelled = true;
		};
	});

	async function copyRoomLink() {
		if (!shareUrl) return;
		try {
			await navigator.clipboard.writeText(shareUrl);
		} catch {
			const textarea = document.createElement("textarea");
			textarea.value = shareUrl;
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand("copy");
			textarea.remove();
		}

		copied = true;
		window.clearTimeout(copyResetTimer);
		copyResetTimer = window.setTimeout(() => (copied = false), 2_000);
	}
</script>

<Popover.Root>
	{#if trigger}
		<Popover.Trigger child={trigger} aria-label="Share this room" />
	{:else}
		<Popover.Trigger
			class={buttonVariants({ variant: "outline", size: "sm" })}
			aria-label="Share this room"
		>
			<Share2 aria-hidden="true" />
			Share
		</Popover.Trigger>
	{/if}
	<Popover.Content align="end" class="w-80 gap-3 rounded-xl p-4">
		<Popover.Header class="gap-1 text-center">
			<Popover.Title>Share this room</Popover.Title>
			<Popover.Description>
				Scan the code or send the link to invite someone.
			</Popover.Description>
		</Popover.Header>

		<div class="mx-auto flex size-48 items-center justify-center overflow-hidden rounded-xl border bg-white p-2">
			{#if qrCodeUrl}
				<img class="size-full" src={qrCodeUrl} alt="QR code for this room" />
			{:else if qrError}
				<p class="px-4 text-center text-xs text-zinc-600">The QR code could not be created.</p>
			{:else}
				<div class="size-36 animate-pulse rounded-lg bg-zinc-100" aria-label="Creating QR code"></div>
			{/if}
		</div>

		<div class="flex gap-2">
			<Input
				value={shareUrl}
				readonly
				aria-label="Room link"
				class="font-mono text-xs"
				onfocus={(event) => event.currentTarget.select()}
			/>
			<Button
				variant="secondary"
				size="icon"
				onclick={copyRoomLink}
				aria-label={copied ? "Room link copied" : "Copy room link"}
				title={copied ? "Copied" : "Copy link"}
			>
				{#if copied}<Check aria-hidden="true" />{:else}<Copy aria-hidden="true" />{/if}
			</Button>
		</div>
		<p class="sr-only" aria-live="polite">{copied ? "Room link copied to clipboard" : ""}</p>
	</Popover.Content>
</Popover.Root>
