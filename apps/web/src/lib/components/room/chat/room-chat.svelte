<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import * as RoomTabs from "$lib/components/room/tabs";
	import { ScrollFollow } from "$lib/components/scroll-follow.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { getMemberColors } from "$lib/member-colors";
	import {
		isMeaningfulUserName,
		setUserName,
		USER_NAME_MAX_LENGTH,
	} from "$lib/user-name";
	import { MessageCircle, Send } from "@lucide/svelte";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import type { ChatMessage } from "../types";
	import RoomMembersPopover from "./room-members-popover.svelte";

	let {
		messages,
		canSend,
		members,
		onMessage,
		active = true,
		guest = false,
		guestUserId,
		guestName = "",
		onGuestName = () => {},
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
		guest?: boolean;
		guestUserId?: string;
		guestName?: string;
		onGuestName?: (name: string) => void;
	} = $props();

	const bottomThreshold = 8;

	let messageBody = $state("");
	let chatError = $state<string | null>(null);
	let guestNameInput = $state("");
	let guestNameError = $state<string | null>(null);
	let savingGuestName = $state(false);
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

	const showGuestNamePrompt = $derived(
		active &&
		guest &&
		!isMeaningfulUserName(guestName),
	);

	$effect(() => {
		if (!guest) {
			guestNameInput = "";
			guestNameError = null;
			return;
		}
	});

	async function saveGuestName(event: SubmitEvent) {
		event.preventDefault();
		savingGuestName = true;
		guestNameError = null;
		try {
			const name = await setUserName(guestNameInput, guestUserId);
			onGuestName(name);
			await invalidateAll();
		} catch (cause) {
			guestNameError =
				cause instanceof Error ? cause.message : "Unable to save your chat name";
		} finally {
			savingGuestName = false;
		}
	}

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

<section class="relative flex h-full min-h-0 flex-col" data-slot="room-chat">
	<div
		class="flex min-h-0 flex-1 flex-col transition-[filter] duration-200"
		class:blur-sm={showGuestNamePrompt}
		class:pointer-events-none={showGuestNamePrompt}
		aria-hidden={showGuestNamePrompt}
	>
		<div class="relative min-h-0 flex-1">
			<RoomTabs.ScrollArea
				bind:ref={messageList}
				onscroll={scrollFollow.onScroll}
				class="h-full"
			>
				<ul class="flex min-h-full flex-col gap-4 p-4">
					{#each messages as message (message._id)}
						{@const memberColors = getMemberColors(message.user._id)}
						<li class="flex gap-3">
							<div class="min-w-0 flex-1 border-s-2 ps-3"
								style:border-color={memberColors.fill}>
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
								<p class="mt-1 wrap-anywhere text-sm leading-relaxed">{message.body}</p>
							</div>
						</li>
					{/each}
					{#if messages.length === 0}
						<li class="flex-1 py-8 text-center text-sm text-muted-foreground">
							<MessageCircle class="mx-auto mb-3 size-7 opacity-50" strokeWidth={1.5} />
							<p class="font-medium text-foreground">Music is better together</p>
							<p class="mt-1 text-xs">Say hello to the room.</p>
						</li>
					{/if}
					<li class="mt-auto flex items-center gap-2 pt-2">
						<RoomMembersPopover {members} /><span class="text-[0.65rem] text-muted-foreground">{members.length} here</span>
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
					<form class="flex gap-2 border-t bg-muted/20 p-3 sm:p-4" onsubmit={submitMessage}>
						<Input
							maxlength={500}
							bind:value={messageBody}
							placeholder="Message the room…"
							aria-label="Chat message"
						/>
						<Button type="submit" size="icon" aria-label="Send message" disabled={!messageBody.trim()}><Send size={16} /></Button>
					</form>
				{/if}
				{#if chatError}
					<p class="px-4 pb-3 text-xs text-destructive" role="alert">
						{chatError}
					</p>
				{/if}
			</RoomTabs.Footer>
		{/if}
	</div>

	{#if showGuestNamePrompt}
		<div
			class="absolute inset-0 z-10 flex items-center justify-center bg-background/65 p-4 backdrop-blur-[2px]"
			role="dialog"
			aria-modal="true"
			aria-labelledby="guest-chat-name-title"
		>
			<div class="w-full max-w-sm rounded-3xl border border-border bg-card p-5 text-card-foreground shadow-xl">
				<div class="space-y-1.5">
					<h2 id="guest-chat-name-title" class="font-heading text-lg font-semibold">
						Choose your chat name
					</h2>
					<p class="text-sm text-muted-foreground">
						This is the name other people in the room will see. You can only set it once.
					</p>
				</div>
				<form class="mt-5 space-y-3" onsubmit={saveGuestName}>
					<Input
						bind:value={guestNameInput}
						maxlength={USER_NAME_MAX_LENGTH}
						placeholder="Your name"
						aria-label="Chat name"
						autocomplete="nickname"
						autofocus
					/>
					{#if guestNameError}
						<p class="text-xs text-destructive" role="alert">{guestNameError}</p>
					{/if}
					<Button
						class="w-full"
						type="submit"
						disabled={savingGuestName || !guestNameInput.trim()}
					>
						{savingGuestName ? "Saving…" : "Continue to chat"}
					</Button>
				</form>
			</div>
		</div>
	{/if}
</section>
