<script lang="ts">
	import RoomPlayer from "$lib/components/room-player.svelte";
	import {
		Avatar,
		AvatarFallback,
		AvatarImage,
	} from "$lib/components/ui/avatar";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { getMemberColor, getMemberColors } from "$lib/member-colors";
	import { Presence } from "$lib/presence.svelte";
	import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
	import { api } from "@partyroom/backend/convex/_generated/api";
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
			id: message._id,
			body: message.body,
			color: getMemberColor(message.user._id),
		})),
	);

	let messageBody = $state("");
	let chatError = $state<string | null>(null);

	async function submitMessage(event: SubmitEvent) {
		event.preventDefault();
		const body = messageBody.trim();
		if (!body) return;
		messageBody = "";
		chatError = null;
		try {
			await sendMessage({ room: roomId, body });
		} catch (cause) {
			messageBody = body;
			chatError =
				cause instanceof Error ? cause.message : "Unable to send message";
		}
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

	<RoomPlayer {roomId} {overlayMessages} />

	<div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
		<section class="rounded-xl border bg-card shadow-sm flex flex-col">
			<div class="border-b p-4"><h2 class="font-semibold">Chat</h2></div>
			<ul class="max-h-72 min-h-40 space-y-3 overflow-y-auto p-4 flex-1">
				{#each messages.data ?? [] as message (message._id)}
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
				{#if (messages.data?.length ?? 0) === 0}
					<li class="py-8 text-center text-sm text-muted-foreground">
						No messages yet.
					</li>
				{/if}
			</ul>
			{#if playback.data?.permissions.sendChat}
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
			{#if chatError}<p class="px-4 pb-3 text-xs text-destructive" role="alert">
					{chatError}
				</p>{/if}
		</section>

		<aside class="space-y-5">
			<section class="rounded-xl border bg-card p-4 shadow-sm">
				<h2 class="font-semibold">In the room</h2>
				<ul class="mt-3 space-y-3">
					{#each onlineUsers as user (user.userId)}
						{@const memberColors = getMemberColors(user.userId)}
						<li class="flex items-center gap-2">
							<Avatar
								class="size-8 border-2"
								style={`border-color: ${memberColors.accent}`}
							>
								{#if user.image}<AvatarImage src={user.image} alt="" />{/if}
								<AvatarFallback
									style={`background-color: ${memberColors.fill}; color: ${memberColors.foreground}`}
									class="font-semibold"
								>
									{(user.name ?? "?").slice(0, 1).toUpperCase()}
								</AvatarFallback>
							</Avatar>
							<span
								class="truncate text-sm font-medium"
								style:color={memberColors.accent}
							>
								{user.name ?? user.username ?? "Guest"}
							</span>
						</li>
					{/each}
				</ul>
			</section>

			{#if playback.data?.permissions.updateRoom && room.data}
				<section class="rounded-xl border bg-card p-4 shadow-sm">
					<h2 class="font-semibold">Visitor permissions</h2>
					<p class="mt-1 text-xs text-muted-foreground">
						Choose what visitors can do in this room.
					</p>
					<div class="mt-3 space-y-3">
						{#each [{ key: "controlPlayback", label: "Control playback" }, { key: "addToQueue", label: "Add songs" }, { key: "reorderQueue", label: "Reorder queue" }, { key: "removeFromQueue", label: "Remove queued songs" }, { key: "sendChat", label: "Send chat messages" }] as permission (permission.key)}
							<label
								class="flex cursor-pointer items-center justify-between gap-3 text-sm"
							>
								<span>{permission.label}</span>
								<input
									type="checkbox"
									class="size-4 accent-primary"
									checked={room.data.memberPermissions[
										permission.key as keyof typeof room.data.memberPermissions
									]}
									onchange={(event) =>
										void setMemberPermission(
											permission.key as keyof typeof room.data.memberPermissions,
											event.currentTarget.checked,
										)}
								/>
							</label>
						{/each}
					</div>
				</section>
			{/if}
		</aside>
	</div>
</div>
