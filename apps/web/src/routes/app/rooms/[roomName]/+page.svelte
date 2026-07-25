<script lang="ts">
	import RoomMedia from "$lib/components/room-media.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import * as Item from "$lib/components/ui/item";
	import { Presence } from "$lib/presence.svelte";
	import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
	import { useMutation, useQuery } from "convex-svelte";
	import type { FunctionReturnType } from "convex/server";
	import type { PageProps } from "./$types";

	const { params, data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	const room = useQuery(
		api.rooms.getRoomByName,
		{ name: params.roomName },
		{ initialData: data.room },
	);

	const roomId = $derived(room.data?._id ?? data.room._id);

	const presence = new Presence({
		get roomId() {
			return roomId;
		},
		get userId() {
			return data.user._id;
		},
	});

	// svelte-ignore state_referenced_locally
	const messages = useQuery(api.chat.getMessages, {
		room: roomId,
	});

	let messageBody = $state("");

	const sendMessage = useMutation(api.chat.sendMessage);
</script>

<Button href="/app" variant="outline"><ArrowLeftIcon /> All rooms</Button>
<h1>Room &ldquo;{room.data?.name}&rdquo;</h1>
<pre class="text-xs text-muted-foreground font-mono">{JSON.stringify(
		room.data,
		null,
		2,
	)}</pre>
<h2>Users</h2>
<ul>
	{#each presence.current as presentUser (presentUser.userId)}
		<Item.Root>
			{#snippet child({ props })}
				<li {...props}>
					<Item.Header>
						<Item.Title>{presentUser.name}</Item.Title>
					</Item.Header>
					<pre class="text-xs text-muted-foreground font-mono">{JSON.stringify(
							presentUser,
							null,
							2,
						)}</pre>
				</li>
			{/snippet}
		</Item.Root>
	{/each}
</ul>
<RoomMedia {roomId} />
<div>
	<h2 class="text-xl font-medium">Chat</h2>
	<ul>
		{#if messages.data}
			{#each messages.data as message (message._id)}
				<li class="flex justify-between items-center">
					<p>{message.body}</p>
					<div>
						<p class="text-xs text-muted-foreground">{message.user.name}</p>
						<p class="text-xs text-muted-foreground">
							{new Date(message._creationTime).toLocaleTimeString()}
						</p>
					</div>
				</li>
			{/each}
		{/if}
	</ul>
	<form
		method="POST"
		onsubmit={async (e) => {
			e.preventDefault();

			if (messageBody.trim() === "") {
				return;
			}

			const rollbackMessageBody = messageBody.trim();
			try {
				await sendMessage(
					{
						room: roomId,
						user: data.user._id,
						body: messageBody.trim(),
					},
					{
						optimisticUpdate: (store, args) => {
							const messages = store.getQuery(api.chat.getMessages, {
								room: args.room,
							});

							const now = Date.now();
							const newMessage = {
								_id: crypto.randomUUID() as Id<"messages">,
								_creationTime: now,
								body: args.body,
								room: roomId,
								user: { _id: data.user._id, name: data.user.name },
							} satisfies FunctionReturnType<
								(typeof api)["chat"]["getMessages"]
							>[number];

							if (typeof messages === "undefined") {
								return;
							}

							store.setQuery(api.chat.getMessages, { room: args.room }, [
								...messages,
								newMessage,
							]);
							messageBody = "";
						},
					},
				);
			} catch {
				messageBody = rollbackMessageBody;
			}
		}}
		class="flex gap-2 items-center"
	>
		<Input bind:value={messageBody} class="flex-1" />
		<Button type="submit">Send</Button>
	</form>
</div>
