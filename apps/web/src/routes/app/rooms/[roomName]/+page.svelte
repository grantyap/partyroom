<script lang="ts">
	import { toChatOverlayMessages } from "$lib/chat-overlay-messages";
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
	import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
	import { useMutation, useQuery } from "convex-svelte";
	import type { PageProps } from "./$types";

	const { params, data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	const room = useQuery(
		api.rooms.getRoomByName,
		{ name: params.roomName },
		{ initialData: data.room },
	);
	const roomId = $derived(room.data?._id ?? data.room._id);
	const playback = useQuery(api.playback.get, () => ({ roomId }));
	const messages = useQuery(api.chat.getMessages, () => ({ room: roomId }));
	const sendMessage = useMutation(api.chat.sendMessage);
	const updateMemberPermissions = useMutation(
		api.rooms.updateMemberPermissions,
	);
	let panelTab = $state("queue");

	const presence = new Presence({
		get roomId() {
			return roomId;
		},
		get userId() {
			return data.user._id;
		},
	});

	const onlineUsers = $derived(
		(presence.current ?? []).filter(({ online }) => online),
	);
	const overlayMessages = $derived(toChatOverlayMessages(messages.data));

	async function onMessage(body: string) {
		const clientMessageId = createUuidInAnyContext();
		await sendMessage(
			{ room: roomId, body, clientMessageId },
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
							_id: data.user._id,
							name: data.user.name ?? undefined,
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
		permission: keyof NonNullable<typeof room.data>["memberPermissions"],
		enabled: boolean,
	) {
		const current = room.data?.memberPermissions;
		if (!current) return;
		await updateMemberPermissions({
			roomId,
			memberPermissions: { ...current, [permission]: enabled },
		});
	}
</script>

<div class="mx-auto w-full max-w-384 space-y-5 p-4 sm:p-6">
	<Playback.Root {roomId} {overlayMessages}>
		<div class="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
			<header
				class="flex flex-wrap items-center justify-between gap-3 xl:col-span-2"
			>
				<div class="space-y-3 w-full">
					<Button href="/app" variant="outline" size="sm"
						><ArrowLeftIcon /> All rooms</Button
					>
					<div>
						<h1 class="font-heading text-xl font-semibold">
							{room.data?.name}
						</h1>
						<Playback.NowPlaying />
						<div>
							<RoomMembersPopover members={onlineUsers} />
							<span class="text-xs text-muted-foreground ms-1">
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
						{onMessage}
					/>
				</RoomTabs.Content>
			</RoomTabs.Root>
		</div>
	</Playback.Root>

	<div class="grid gap-5 md:grid-cols-2">
		{#if playback.data?.permissions.updateRoom && room.data}
			<RoomPermissions
				permissions={room.data.memberPermissions}
				onChange={(permission, enabled) =>
					void setMemberPermission(permission, enabled)}
			/>
		{/if}
	</div>
</div>
