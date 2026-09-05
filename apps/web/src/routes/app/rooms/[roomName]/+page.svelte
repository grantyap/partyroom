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
	import type { PageProps } from "./$types";

	const { params, data }: PageProps = $props();
	const auth = useAuth();

	let panelTab = $state("queue");
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
	<div class="mx-auto w-full max-w-384 space-y-5 p-4 sm:p-6">
		<Playback.Root roomId={activeRoomId} {overlayMessages}>
			<div class="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
				<header
					class="flex flex-wrap items-center justify-between gap-3 xl:col-span-2"
				>
					<div class="w-full space-y-3">
						<Button href="/app" variant="outline" size="sm"
							><ArrowLeftIcon /> All rooms</Button
						>
						<div>
							<h1 class="font-heading text-xl font-semibold">
								{roomData?.name}
							</h1>
							<Playback.NowPlaying />
							<div>
								<RoomMembersPopover members={onlineUsers} />
								<span class="ms-1 text-xs text-muted-foreground">
									{onlineUsers.length}
									{onlineUsers.length === 1 ? "person" : "people"} here
								</span>
							</div>
						</div>
					</div>
				</header>

				<section class="min-w-0 space-y-3" data-slot="playback-main">
					<div class="flex items-center justify-between gap-3 xl:justify-end">
						<div class="flex items-center gap-2">
							<Playback.Share />
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

					<RoomTabs.Content value="queue">
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

		<div class="grid gap-5 md:grid-cols-2">
			{#if playback.data?.permissions.updateRoom && roomData}
				<RoomPermissions
					permissions={roomData.memberPermissions}
					onChange={(permission, enabled) =>
						void setMemberPermission(permission, enabled)}
				/>
			{/if}
		</div>
	</div>
{/if}
