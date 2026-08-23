<script lang="ts">
	import {
		RoomChat,
		RoomMembers,
		RoomPermissions,
		type ChatMessage,
	} from "$lib/components/room";
	import * as Playback from "$lib/components/room/playback";
	import { createUuidInAnyContext } from "$lib/context-uuid";
	import { Button } from "$lib/components/ui/button";
	import * as Tabs from "$lib/components/ui/tabs";
	import { getMemberColor } from "$lib/member-colors";
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
	const overlayMessages = $derived(
		(messages.data ?? []).map((message) => ({
			id: message.clientMessageId,
			body: message.body,
			color: getMemberColor(message.user._id),
		})),
	);

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

<div class="mx-auto w-full max-w-[96rem] space-y-5 p-4 sm:p-6">
	<header class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-3">
			<Button href="/app" variant="outline" size="sm"
				><ArrowLeftIcon /> All rooms</Button
			>
			<div>
				<h1 class="text-xl font-semibold">{room.data?.name}</h1>
				<p class="text-xs text-muted-foreground">
					{onlineUsers.length}
					{onlineUsers.length === 1 ? "person" : "people"} here
				</p>
			</div>
		</div>
	</header>

	<Playback.Root {roomId} {overlayMessages}>
		<Playback.Stage />
		<Tabs.Root
			bind:value={panelTab}
			class="min-h-0 gap-0 overflow-hidden rounded-xl border bg-card shadow-sm"
		>
			<div class="border-b p-3">
				<Tabs.List class="grid w-full grid-cols-2">
					<Tabs.Trigger value="queue">
						Queue
						<Playback.QueueCount />
					</Tabs.Trigger>
					<Tabs.Trigger value="chat">Chat</Tabs.Trigger>
				</Tabs.List>
			</div>

			<Tabs.Content value="queue" class="m-0 min-h-0 overflow-hidden">
				<Playback.Queue />
			</Tabs.Content>
			<Tabs.Content value="chat" class="m-0 min-h-0 overflow-hidden">
				<RoomChat
					messages={messages.data ?? []}
					canSend={playback.data?.permissions.sendChat ?? false}
					active={panelTab === "chat"}
					{onMessage}
				/>
			</Tabs.Content>
		</Tabs.Root>
	</Playback.Root>

	<div class="grid gap-5 md:grid-cols-2">
		<RoomMembers members={onlineUsers} />

		{#if playback.data?.permissions.updateRoom && room.data}
			<RoomPermissions
				permissions={room.data.memberPermissions}
				onChange={(permission, enabled) =>
					void setMemberPermission(permission, enabled)}
			/>
		{/if}
	</div>
</div>
