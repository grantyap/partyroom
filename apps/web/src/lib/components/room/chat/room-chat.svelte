<script lang="ts">
	import * as RoomTabs from "$lib/components/room/tabs";
	import { ScrollFollow } from "$lib/components/scroll-follow.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { getMemberColors } from "$lib/member-colors";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import type { ChatMessage } from "../types";
	import RoomMembersPopover from "./room-members-popover.svelte";

	let {
		messages,
		canSend,
		members,
		onMessage,
		active = true,
	}: {
		messages: ChatMessage[];
		canSend: boolean;
		members: Array<{
			userId: string;
			name?: string | null;
			username?: string | null;
			image?: string | null;
		}>;
		onMessage: (body: string) => void;
		active?: boolean;
	} = $props();

	const bottomThreshold = 8;

	let messageBody = $state("");
	let chatError = $state<string | null>(null);
	let messageList = $state<HTMLDivElement | null>(null);
	const scrollFollow = new ScrollFollow({
		getViewport: () => messageList,
		getTargetScrollTop: () =>
			messageList
				? Math.max(0, messageList.scrollHeight - messageList.clientHeight)
				: null,
		isAtFollowPosition: (viewport) =>
			viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
			bottomThreshold,
	});

	$effect(() => {
		const latestMessageId = messages.at(-1)?._id;
		if (!active || !latestMessageId || !scrollFollow.isFollowing) return;

		void scrollFollow.follow("instant");
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
		<RoomTabs.ScrollArea
			bind:ref={messageList}
			onscroll={scrollFollow.onScroll}
			class="h-full"
		>
			<ul class="space-y-3 p-4 pb-0 h-full flex flex-col">
				{#each messages as message (message._id)}
					{@const memberColors = getMemberColors(message.user._id)}
					<li class="flex gap-3">
						<div class="min-w-0 flex-1 rounded-4xl bg-muted px-4 py-3">
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
							<p class="mt-0.5 wrap-break-word text-sm">{message.body}</p>
						</div>
					</li>
				{/each}
				{#if messages.length === 0}
					<li class="py-8 flex-1 text-center text-sm text-muted-foreground">
						No messages yet.
					</li>
				{/if}
				<li class="-mt-3 flex items-center">
					<RoomMembersPopover {members} />
				</li>
			</ul>
		</RoomTabs.ScrollArea>

		{#if !scrollFollow.isFollowing}
			<Button
				variant="secondary"
				size="xs"
				class="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
				onclick={() => void scrollFollow.sync()}
			>
				<ChevronDownIcon />
				Scroll to bottom
			</Button>
		{/if}
	</div>

	{#if canSend || chatError}
		<RoomTabs.Footer>
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
		</RoomTabs.Footer>
	{/if}
</section>
