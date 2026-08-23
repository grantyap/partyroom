<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { getMemberColors } from "$lib/member-colors";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import { tick } from "svelte";
	import type { ChatMessage } from "../types";

	let {
		messages,
		canSend,
		onMessage,
		active = true,
	}: {
		messages: ChatMessage[];
		canSend: boolean;
		onMessage: (body: string) => void;
		active?: boolean;
	} = $props();

	const bottomThreshold = 8;

	let messageBody = $state("");
	let chatError = $state<string | null>(null);
	let messageList: HTMLUListElement;
	let isAtBottom = $state(true);

	function updateScrollPosition() {
		isAtBottom =
			messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight <=
			bottomThreshold;
	}

	function scrollToBottom(behavior: ScrollBehavior = "smooth") {
		messageList.scrollTo({ top: messageList.scrollHeight, behavior });
	}

	$effect(() => {
		const latestMessageId = messages.at(-1)?._id;
		if (!active || !latestMessageId || !isAtBottom) return;

		void tick().then(() => scrollToBottom("instant"));
	});

	async function submitMessage(event: SubmitEvent) {
		event.preventDefault();
		const body = messageBody.trim();
		if (!body) return;
		messageBody = "";
		chatError = null;
		try {
			await onMessage(body);
		} catch (cause) {
			messageBody = body;
			chatError =
				cause instanceof Error ? cause.message : "Unable to send message";
		}
	}
</script>

<section class="flex h-full min-h-0 flex-col" data-slot="room-chat">
	<div class="relative min-h-0 flex-1">
		<ul
			bind:this={messageList}
			onscroll={updateScrollPosition}
			class="h-full min-h-40 space-y-3 overflow-y-auto p-4"
		>
			{#each messages as message (message._id)}
				{@const memberColors = getMemberColors(message.user._id)}
				<li class="flex gap-3">
					<div class="min-w-0 flex-1 rounded-lg bg-muted px-3 py-2">
						<div class="flex items-baseline justify-between gap-3">
							<p
								class="truncate text-xs font-semibold"
								style:color={memberColors.accent}
							>
								{message.user.name ?? "Guest"}
							</p>
							<time class="shrink-0 text-[0.7rem] text-muted-foreground">
								{new Date(message._creationTime).toLocaleTimeString([], {
									hour: "numeric",
									minute: "2-digit",
								})}
							</time>
						</div>
						<p class="mt-0.5 break-words text-sm">{message.body}</p>
					</div>
				</li>
			{/each}
			{#if messages.length === 0}
				<li class="py-8 text-center text-sm text-muted-foreground">
					No messages yet.
				</li>
			{/if}
		</ul>

		{#if !isAtBottom}
			<Button
				variant="secondary"
				size="xs"
				class="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
				onclick={() => scrollToBottom()}
			>
				<ChevronDownIcon />
				Scroll to bottom
			</Button>
		{/if}
	</div>

	{#if canSend}
		<form class="flex gap-2 border-t p-3" onsubmit={submitMessage}>
			<Input
				maxlength={500}
				bind:value={messageBody}
				placeholder="Say something…"
				aria-label="Chat message"
			/>
			<Button type="submit" disabled={!messageBody.trim()}>Send</Button>
		</form>
	{/if}
	{#if chatError}
		<p class="px-4 pb-3 text-xs text-destructive" role="alert">
			{chatError}
		</p>
	{/if}
</section>
