<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { toChatOverlayMessages } from "$lib/chat-overlay-messages";
	import { authClient } from "$lib/auth-client";
	import ErrorState from "$lib/components/error-state.svelte";
	import {
		RoomChat,
		RoomLyrics,
		RoomPermissions,
		type ChatMessage,
	} from "$lib/components/room";
	import RoomMembersPopover from "$lib/components/room/chat/room-members-popover.svelte";
	import * as Playback from "$lib/components/room/playback";
	import * as RoomTabs from "$lib/components/room/tabs";
	import { Button } from "$lib/components/ui/button";
	import { createUuidInAnyContext } from "$lib/context-uuid";
	import { Presence } from "$lib/presence.svelte";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
	import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
	import { useMutation, useQuery } from "convex-svelte";
	import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import SettingsIcon from "@lucide/svelte/icons/settings";
	import type { PageProps } from "./$types";

	const { params, data }: PageProps = $props();
	const auth = useAuth();

	let panelTab = $state("queue");
	let playerHeight = $state(0);
	let joinAttempted = $state(false);
	let joinError = $state<string | null>(null);
	let displayName = $state("");

	const room = useQuery(
		api.rooms.getRoomByName,
		() => (auth.isAuthenticated ? { name: params.roomName } : "skip"),
		() => ({ initialData: data.room ?? undefined }),
	);
	const roomData = $derived(room.data ?? data.room);
	const roomId = $derived(roomData?._id ?? null);
	const playback = useQuery(api.playback.get, () =>
		roomId ? { roomId } : "skip",
	);
	const messages = useQuery(api.chat.getMessages, () =>
		roomId ? { room: roomId } : "skip",
	);
	const sendMessage = useMutation(api.chat.sendMessage);
	const updateMemberPermissions = useMutation(
		api.rooms.updateMemberPermissions,
	);

	const presence = new Presence({
		roomId: () => roomId,
		userId: () => data.user?._id ?? null,
	});

	const onlineUsers = $derived(
		(presence.current ?? []).filter(({ online }) => online),
	);
	const overlayMessages = $derived(toChatOverlayMessages(messages.data));
	const isGuest = $derived(
		data.user != null &&
		"isAnonymous" in data.user &&
		data.user.isAnonymous === true,
	);
	const roomError = $derived.by(() => {
		if (!room.error) return null;
		return room.error.message.toLowerCase().includes("room not found")
			? "This room does not exist or is no longer available."
			: "Unable to load this room.";
	});

	$effect(() => {
		const serverName = data.user?.name;
		if (serverName && serverName !== displayName) {
			displayName = serverName;
		}
	});

	$effect(() => {
		if (auth.isLoading) return;

		if (auth.isAuthenticated) {
			// Allow a fresh guest session if this page stays mounted after logout.
			joinAttempted = false;
			return;
		}

		if (joinAttempted) return;

		joinAttempted = true;

		void signInAsGuest();
	});

	async function signInAsGuest() {
		joinError = null;
		try {
			const result = await authClient.signIn.anonymous();
			if (result.error) {
				throw new Error(result.error.message);
			}

			await invalidateAll();
		} catch (cause) {
			joinError =
				cause instanceof Error
					? cause.message
					: "Unable to join this room as a guest";
		}
	}

	function retryGuestSignIn() {
		joinAttempted = false;
		joinError = null;
	}

	function handleGuestName(name: string) {
		displayName = name;
	}

	async function onMessage(body: string) {
		const currentRoomId = roomId;
		const currentUser = data.user;
		if (!currentRoomId || !currentUser) return;

		const clientMessageId = createUuidInAnyContext();
		await sendMessage(
			{ room: currentRoomId, body, clientMessageId },
			{
				optimisticUpdate: (store, args) => {
					const currentMessages = store.getQuery(api.chat.getMessages, {
						room: args.room,
					});
					if (!currentMessages) return;

					const optimisticMessage = {
						_id: clientMessageId as Id<"messages">,
						_creationTime: Date.now(),
						room: args.room,
						body: args.body,
						clientMessageId,
						user: {
							_id: currentUser._id,
							name: displayName || currentUser.name || undefined,
						},
					} satisfies ChatMessage;

					store.setQuery(
						api.chat.getMessages,
						{ room: args.room },
						[...currentMessages, optimisticMessage].slice(-50),
					);
				},
			},
		);
	}

	async function setMemberPermission(
		permission: keyof NonNullable<typeof roomData>["memberPermissions"],
		enabled: boolean,
	) {
		const current = roomData?.memberPermissions;
		if (!current || !roomId) return;
		await updateMemberPermissions({
			roomId,
			memberPermissions: { ...current, [permission]: enabled },
		});
	}
</script>

{#if joinError}
	<ErrorState
		title="Unable to join room"
		description="We couldn't open this room as a guest. Try again or head back to your room list."
		message={joinError}
		onRetry={retryGuestSignIn}
		backLabel="All rooms"
	/>
{:else if roomError}
	<ErrorState
		title="Unable to load room"
		description={roomError}
		backLabel="All rooms"
	/>
{:else if !auth.isAuthenticated || !data.user || !roomId}
	<div class="mx-auto flex min-h-[50dvh] w-full max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
		<div class="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"></div>
		<p class="text-sm text-muted-foreground">Joining {params.roomName}…</p>
	</div>
{:else}
	{@const activeRoomId = roomId}
	<div style={`--room-player-height: ${playerHeight}px`} class="room-view mx-auto w-full max-w-384 space-y-4 p-3 sm:space-y-5 sm:p-6">
		<Playback.Root roomId={activeRoomId} {overlayMessages}>
			<div class="grid min-h-0 gap-3 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
				<header class="flex flex-wrap items-center justify-between gap-3 xl:col-span-2">
					<div class="min-w-0 flex-1 space-y-1 sm:space-y-2">
						<Button href="/app" variant="ghost" size="sm" class="-ms-3 hidden text-muted-foreground sm:inline-flex">
							<ArrowLeftIcon /> All rooms
						</Button>
						<h1 class="font-heading text-base font-semibold tracking-tight wrap-anywhere sm:text-2xl">
							{roomData?.name}
						</h1>
						<div class="flex items-center gap-2">
							<RoomMembersPopover members={onlineUsers} />
							<span class="text-xs text-muted-foreground">
								{onlineUsers.length} {onlineUsers.length === 1 ? "person" : "people"} here
							</span>
						</div>
					</div>
					<Playback.Share />
				</header>

				<section bind:clientHeight={playerHeight} class="room-player min-w-0 space-y-2 bg-background sm:space-y-3" data-slot="playback-main" aria-label="Player">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="min-w-0 flex-1 basis-48">
							<Playback.NowPlaying>
								{#snippet children({ title, hasQueuedMedia })}
									<p class="text-xs font-medium text-muted-foreground">Now playing</p>
									<p class="truncate text-sm font-medium" title={title ?? undefined}>
										{title ?? (hasQueuedMedia ? "Preparing the next song…" : "Choose the first song")}
									</p>
								{/snippet}
							</Playback.NowPlaying>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<Playback.Lyrics />
							<Playback.TvMode />
						</div>
					</div>
					<Playback.Player />
					<Playback.Error />
				</section>
				<RoomTabs.Root bind:value={panelTab}>
					<RoomTabs.List>
						<RoomTabs.Trigger value="queue">
							Queue
							<Playback.QueueCount />
						</RoomTabs.Trigger>
						<RoomTabs.Trigger value="lyrics">Lyrics</RoomTabs.Trigger>
						<RoomTabs.Trigger value="chat">Chat</RoomTabs.Trigger>
					</RoomTabs.List>

					<RoomTabs.Content value="queue" class="room-queue-panel">
						<Playback.Queue />
					</RoomTabs.Content>
					<RoomTabs.Content value="lyrics">
						<RoomLyrics active={panelTab === "lyrics"} />
					</RoomTabs.Content>
					<RoomTabs.Content value="chat">
						<RoomChat
							messages={messages.data ?? []}
							canSend={playback.data?.permissions.sendChat ?? false}
							members={onlineUsers}
							active={panelTab === "chat"}
							guest={isGuest}
							guestUserId={data.user?._id}
							guestName={displayName}
							onGuestName={handleGuestName}
							onMessage={onMessage}
						/>
					</RoomTabs.Content>
				</RoomTabs.Root>
			</div>
		</Playback.Root>

		{#if playback.data?.permissions.updateRoom && roomData}
			<details class="group rounded-2xl border bg-muted/20">
				<summary class="flex cursor-pointer list-none items-center gap-2 rounded-2xl p-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
					<SettingsIcon class="size-4 text-muted-foreground" />
					Room settings
					<span class="ms-auto hidden text-xs font-normal text-muted-foreground sm:inline">Visitor permissions</span>
					<ChevronDownIcon class="ms-auto size-4 text-muted-foreground transition-transform group-open:rotate-180 sm:ms-2" />
				</summary>
				<div class="max-w-xl px-4 pb-4">
					<RoomPermissions
						permissions={roomData.memberPermissions}
						onChange={(permission, enabled) =>
							void setMemberPermission(permission, enabled)}
					/>
				</div>
			</details>
		{/if}
	</div>
{/if}

<style>
	@media (width < 640px) {
		.room-view :global([data-slot="room-tabs-root"] [data-slot="tabs"]) {
			overflow: visible;
		}

		/* Let the queue grow with the page; chat and lyrics retain scroll-follow viewports. */
		.room-view :global([data-slot="room-tabs-root"] > [data-slot="card"]) {
			height: auto;
			min-height: 60svh;
			overflow: visible;
		}

		.room-view :global([data-slot="tabs-content"]:not(.room-queue-panel)) {
			height: 65svh;
			flex: none;
		}

		.room-view :global(.room-queue-panel [data-slot="room-tabs-scroll-area"]) {
			overflow-y: visible;
		}
	}

	@media (width < 640px) and (height >= 600px) {
		.room-view :global([data-slot="room-tabs-list"]) {
			position: sticky;
			top: calc(4rem + var(--room-player-height) + 1px);
			z-index: 20;
			background: var(--background);
		}

		/* Keep one live player mounted, with room for the panel below it. */
		.room-player {
			position: sticky;
			top: 4rem;
			z-index: 30;
			padding-block: 0.5rem;
			border-bottom: 1px solid var(--border);
		}

		.room-player:has(:global([data-slot="playback-player"].fixed)) {
			z-index: 50;
		}

		.room-player :global([data-slot="playback-player"]:not(.fixed)) {
			max-width: min(100%, 52svh);
			margin-inline: auto;
		}
	}
</style>
