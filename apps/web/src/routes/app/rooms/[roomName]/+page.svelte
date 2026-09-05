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
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import { createUuidInAnyContext } from "$lib/context-uuid";
	import { Presence } from "$lib/presence.svelte";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
	import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
	import { useMutation, useQuery } from "convex-svelte";
	import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
	import * as Drawer from "$lib/components/ui/drawer";
	import { Headphones, ListMusic, MessageCircle, Mic2, Music2, Radio, Users } from "@lucide/svelte";
	import SettingsIcon from "@lucide/svelte/icons/settings";
	import type { PageProps } from "./$types";

	const { params, data }: PageProps = $props();
	const auth = useAuth();

	let panelTab = $state("queue");
	let settingsOpen = $state(false);
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

<svelte:head>
	<title>{roomData?.name.replaceAll("-", " ") ?? params.roomName} · Partyroom</title>
</svelte:head>

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
	<div class="room-workspace">
		<Playback.Root roomId={activeRoomId} {overlayMessages}>
			<header class="room-heading">
				<div class="room-identity">
					<Button href="/app" variant="ghost" size="icon" aria-label="Back to rooms" class="shrink-0">
						<ArrowLeftIcon />
					</Button>
					<div class="min-w-0">
						<p class="eyebrow">Listening room <span class="inline font-normal tracking-normal normal-case min-[800px]:hidden">· {onlineUsers.length} here</span></p>
						<h1 class="font-heading" title={roomData?.name}>{roomData?.name.replaceAll("-", " ")}</h1>
					</div>
				</div>
				<div class="room-actions">
					<div class="room-members">
						<RoomMembersPopover members={onlineUsers} />
						<span>{onlineUsers.length} here</span>
					</div>
					<Playback.Share>
						{#snippet trigger({ props })}
							<button {...props} class={buttonVariants({ size: "sm" })}><Users size={16} /> Invite</button>
						{/snippet}
					</Playback.Share>
					{#if playback.data?.permissions.updateRoom}
						<Button variant="ghost" size="icon" aria-label="Room settings" onclick={() => settingsOpen = true}>
							<SettingsIcon />
						</Button>
					{/if}
				</div>
			</header>

			<div class="room-body">
				<section class="stage" aria-label="Player">
					<div class="stage-toolbar">
						<span class="stage-label"><Radio size={15} /> THE STAGE</span>
						<div class="stage-tools"><Playback.Lyrics /><Playback.TvMode /></div>
					</div>
					<div class="stage-screen">
						<Playback.Player>
							{#snippet empty({ hasQueuedMedia })}
								<div class="stage-empty">
									<div class="stage-empty-icon"><Headphones size={32} strokeWidth={1.4} /></div>
									<h2 class="font-heading">{hasQueuedMedia ? "Your music is on its way." : "Good company. Great music."}</h2>
									<p>{hasQueuedMedia ? "The next ready song will start automatically." : "Every room starts with a song. Add one to the queue."}</p>
								</div>
							{/snippet}
						</Playback.Player>
					</div>
					<div class="stage-caption">
						<div class="track-icon"><Music2 size={21} /></div>
						<div class="min-w-0">
							<Playback.NowPlaying>
								{#snippet children({ title, hasQueuedMedia })}
									<p class="eyebrow">{title ? "Now playing" : "Up next"}</p>
									<h2 class="font-heading" title={title ?? undefined}>{title ?? (hasQueuedMedia ? "Preparing the next song…" : "Your first song goes here")}</h2>
								{/snippet}
							</Playback.NowPlaying>
						</div>
					</div>
					<Playback.Error class="px-4 pb-3 text-red-300" />
				</section>

				<RoomTabs.Root bind:value={panelTab} workspace>
					<RoomTabs.List aria-label="Room activity">
						<RoomTabs.Trigger value="queue"><ListMusic size={17} /> Queue <Playback.QueueCount /></RoomTabs.Trigger>
						<RoomTabs.Trigger value="lyrics"><Mic2 size={17} /> Lyrics</RoomTabs.Trigger>
						<RoomTabs.Trigger value="chat"><MessageCircle size={17} /> Chat</RoomTabs.Trigger>
					</RoomTabs.List>
					<RoomTabs.Content value="queue"><Playback.Queue /></RoomTabs.Content>
					<RoomTabs.Content value="lyrics"><RoomLyrics active={panelTab === "lyrics"} /></RoomTabs.Content>
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
	</div>
	{#if playback.data?.permissions.updateRoom && roomData}
		<Drawer.Root bind:open={settingsOpen}>
			<Drawer.Content class="mx-auto max-w-lg">
				<Drawer.Header>
					<Drawer.Title>Room settings</Drawer.Title>
					<Drawer.Description>Choose what visitors can do. Changes save automatically.</Drawer.Description>
				</Drawer.Header>
				<div class="overflow-y-auto px-4 pb-4">
					<RoomPermissions permissions={roomData.memberPermissions} onChange={setMemberPermission} />
				</div>
				<Drawer.Footer><Button onclick={() => settingsOpen = false}>Done</Button></Drawer.Footer>
			</Drawer.Content>
		</Drawer.Root>
	{/if}
{/if}

<style>
	.room-workspace {
		height: calc(100dvh - 4rem);
		min-height: 36rem;
		display: flex;
		flex-direction: column;
		padding: 0 1.5rem 1.5rem;
		background: color-mix(in oklch, var(--muted) 65%, var(--background));
	}

	.room-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.1rem 0;
	}

	.room-identity, .room-actions, .room-members {
		display: flex;
		align-items: center;
		gap: .75rem;
		min-width: 0;
	}

	.room-identity {
		flex: 1;
	}

	.room-heading h1 {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 1.1rem;
		font-weight: 650;
		text-transform: capitalize;
		letter-spacing: -.025em;
	}

	.eyebrow {
		font-size: .625rem;
		font-weight: 650;
		letter-spacing: .14em;
		text-transform: uppercase;
		color: var(--muted-foreground);
		margin-bottom: .2rem;
	}

	.room-members {
		font-size: .75rem;
		color: var(--muted-foreground);
		margin-right: .5rem;
		white-space: nowrap;
	}

	.room-body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 24rem;
		gap: 1rem;
		flex: 1;
		min-height: 0;
	}

	.stage {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		border-radius: 1.25rem;
		background: #15131c;
		color: #f7f5fc;
		overflow: hidden;
		box-shadow: 0 8px 32px #18102212;
	}

	.stage-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: .75rem;
		padding: 1rem 1.25rem;
	}

	.stage-label {
		display: flex;
		align-items: center;
		gap: .5rem;
		font-size: .625rem;
		letter-spacing: .16em;
		color: #bdb5cc;
	}

	.stage-tools {
		display: flex;
		gap: .4rem;
	}

	.stage-tools :global(button) {
		border-color: #ffffff20;
		color: #ded8ea;
		background: #ffffff08;
		border-radius: .5rem;
		box-shadow: none;
	}

	.stage-tools :global(button:hover) {
		background: #ffffff18;
	}

	.stage-screen {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #0b0a0f;
		container-type: size;
	}

	.stage-screen :global([data-slot="playback-player"]:not(.fixed)) {
		width: 100%;
		max-width: calc(100cqh * 16 / 9);
		border: 0;
		border-radius: 0;
		box-shadow: none;
	}

	.stage-caption {
		display: flex;
		align-items: center;
		gap: .875rem;
		padding: 1.25rem;
	}

	.stage-caption .eyebrow {
		color: #a99bbf;
	}

	.stage-caption h2 {
		font-size: 1rem;
		font-weight: 550;
		letter-spacing: -.02em;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.track-icon {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		flex-shrink: 0;
		border-radius: .8rem;
		background: #bfa3ff18;
		color: #cab1ff;
	}

	.stage-empty {
		display: flex;
		aspect-ratio: 16 / 9;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		padding: 1rem;
		text-align: center;
		background: radial-gradient(ellipse at center, #49335d55, transparent 70%);
	}

	.stage-empty-icon {
		color: #d1b5ff;
		margin-bottom: 1.25rem;
	}

	.stage-empty h2 {
		font-size: clamp(1rem, 2vw, 1.8rem);
		letter-spacing: -.04em;
		font-weight: 550;
	}

	.stage-empty p {
		max-width: 20rem;
		font-size: .8rem;
		line-height: 1.6;
		color: #a69eaf;
		margin-top: .5rem;
	}

	@media (width < 1100px) {
		.room-body {
			grid-template-columns: minmax(0, 1fr) 21rem;
		}

		.room-workspace {
			padding-inline: 1rem;
		}

	}

	@media (width < 800px) {
		.room-workspace {
			padding: 0 .75rem max(.75rem, env(safe-area-inset-bottom));
			min-height: 34rem;
		}

		.room-heading {
			padding: .7rem 0;
			gap: .5rem;
		}

		.room-identity {
			gap: .25rem;
		}

		.room-heading h1 {
			font-size: .85rem;
		}

		.room-heading .eyebrow {
			font-size: .55rem;
		}

		.room-actions {
			gap: .25rem;
		}

		.room-members {
			display: none;
		}


		.room-body {
			grid-template-columns: 1fr;
			grid-template-rows: auto minmax(0, 1fr);
			gap: .75rem;
		}

		.stage {
			border-radius: .9rem;
		}

		.stage-toolbar {
			padding: .5rem .75rem;
		}

		.stage-label {
			font-size: .55rem;
		}

		.stage-tools :global(button) {
			height: 1.9rem;
			font-size: .65rem;
			padding-inline: .5rem;
		}

		.stage-screen {
			flex: none;
			height: min(24dvh, 13rem);
		}

		.stage-caption {
			padding: .6rem .75rem;
			gap: .6rem;
		}

		.stage-caption h2 {
			font-size: .8rem;
		}

		.stage-caption .eyebrow {
			font-size: .5rem;
		}

		.track-icon {
			width: 2rem;
			height: 2rem;
			border-radius: .5rem;
		}

		.stage-empty-icon {
			margin-bottom: .5rem;
		}

		.stage-empty-icon :global(svg) {
			width: 22px;
			height: 22px;
		}

		.stage-empty p {
			font-size: .65rem;
			max-width: 17rem;
		}

	}

	@media (640px <= width < 800px) {
		.stage-screen {
			height: min(34dvh, 22rem);
		}
	}

	@media (height < 600px) {
		.room-workspace {
			height: auto;
			min-height: calc(100dvh - 4rem);
		}

		.room-body {
			min-height: 32rem;
		}

	}
</style>
