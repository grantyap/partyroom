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
		type RoomMemberPermission,
	} from "$lib/components/room";
	import RoomMembersPopover from "$lib/components/room/chat/room-members-popover.svelte";
	import * as Playback from "$lib/components/room/playback";
	import * as RoomTabs from "$lib/components/room/tabs";
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import { createUuidInAnyContext } from "$lib/context-uuid";
	import { Presence } from "$lib/presence.svelte";
	import { capabilities, hasCapability } from "$lib/capabilities";
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
	const canViewRoomList = $derived(hasCapability(data.user, capabilities.rooms.list));
	const isGuest = $derived(data.user?.isAnonymous === true);
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
		permission: RoomMemberPermission,
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
		backHref={canViewRoomList ? "/app" : null}
	/>
{:else if roomError}
	<ErrorState
		title="Unable to load room"
		description={roomError}
		backLabel="All rooms"
		backHref={canViewRoomList ? "/app" : null}
	/>
{:else if !auth.isAuthenticated || !data.user || !roomId}
	<div class="mx-auto flex min-h-[50dvh] w-full max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
		<div class="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"></div>
		<p class="text-sm text-muted-foreground">Joining {params.roomName}…</p>
	</div>
{:else}
	{@const activeRoomId = roomId}
	<div
		class="flex h-[calc(100dvh-4rem)] min-h-144 flex-col bg-[color-mix(in_oklch,var(--muted)_65%,var(--background))] px-6 pb-6 max-[1100px]:px-4 max-[800px]:min-h-136 max-[800px]:px-3 max-[800px]:pb-[max(.75rem,env(safe-area-inset-bottom))] [@media(height<600px)]:h-auto [@media(height<600px)]:min-h-[calc(100dvh-4rem)]"
	>
		<Playback.Root roomId={activeRoomId} {overlayMessages}>
			<header class="flex items-center justify-between gap-4 py-[1.1rem] max-[800px]:gap-2 max-[800px]:py-[.7rem]">
				<div class="flex min-w-0 flex-1 items-center gap-3 max-[800px]:gap-1">
					{#if canViewRoomList}
						<Button href="/app" variant="ghost" size="icon" aria-label="Back to rooms" class="shrink-0">
							<ArrowLeftIcon />
						</Button>
					{/if}
					<div class="min-w-0">
						<p class="mb-[.2rem] text-[.625rem] font-[650] tracking-[.14em] text-muted-foreground uppercase max-[800px]:text-[.55rem]">Listening room <span class="inline font-normal tracking-normal normal-case min-[800px]:hidden">· {onlineUsers.length} here</span></p>
						<h1 class="overflow-hidden font-heading text-[1.1rem] font-[650] tracking-[-.025em] text-ellipsis whitespace-nowrap capitalize max-[800px]:text-[.85rem]" title={roomData?.name}>{roomData?.name.replaceAll("-", " ")}</h1>
					</div>
				</div>
				<div class="flex min-w-0 items-center gap-3 max-[800px]:gap-1">
					<div class="mr-2 flex min-w-0 items-center gap-3 whitespace-nowrap text-xs text-muted-foreground max-[800px]:hidden">
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

			<div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_24rem] gap-4 max-[1100px]:grid-cols-[minmax(0,1fr)_21rem] max-[800px]:grid-cols-1 max-[800px]:grid-rows-[auto_minmax(0,1fr)] max-[800px]:gap-3 [@media(height<600px)]:min-h-128">
				<section
					class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.25rem] bg-(--stage-background) text-(--stage-foreground) shadow-[0_8px_32px_var(--stage-shadow)] max-[800px]:rounded-[.9rem]"
					style="
						--stage-background: color-mix(in oklch, var(--primary) 8%, black);
						--stage-screen: color-mix(in oklch, var(--primary) 3%, black);
						--stage-foreground: color-mix(in oklch, var(--primary) 4%, white);
						--stage-muted: color-mix(in oklch, var(--stage-foreground) 72%, transparent);
						--stage-subtle: color-mix(in oklch, var(--stage-foreground) 60%, transparent);
						--stage-accent: color-mix(in oklch, var(--primary) 45%, white);
						--stage-shadow: color-mix(in oklch, var(--primary) 7%, transparent);
						--stage-tool-border: color-mix(in oklch, var(--stage-foreground) 12%, transparent);
						--stage-tool-foreground: color-mix(in oklch, var(--stage-foreground) 88%, transparent);
						--stage-tool-background: color-mix(in oklch, var(--stage-foreground) 3%, transparent);
						--stage-tool-hover: color-mix(in oklch, var(--stage-foreground) 9%, transparent);
						--stage-icon-background: color-mix(in oklch, var(--primary) 12%, transparent);
						--stage-glow: color-mix(in oklch, var(--primary) 32%, transparent);
						--stage-empty-icon: color-mix(in oklch, var(--primary) 38%, white);
					"
					aria-label="Player"
				>
					<div class="flex items-center justify-between gap-3 px-5 py-4 max-[800px]:px-3 max-[800px]:py-2">
						<span class="flex items-center gap-2 text-[.625rem] tracking-[.16em] text-(--stage-muted) max-[800px]:text-[.55rem]"><Radio size={15} /> THE STAGE</span>
						<div class="flex gap-[.4rem] [&_button]:rounded-lg [&_button]:border-(--stage-tool-border) [&_button]:bg-(--stage-tool-background) [&_button]:text-(--stage-tool-foreground) [&_button]:shadow-none [&_button:hover]:bg-(--stage-tool-hover) max-[800px]:[&_button]:h-[1.9rem] max-[800px]:[&_button]:px-2 max-[800px]:[&_button]:text-[.65rem]"><Playback.TvMode /></div>
					</div>
					<div class="flex min-h-0 flex-1 items-center justify-center bg-(--stage-screen) [container-type:size] [&_[data-slot=playback-player]:not(.fixed)]:w-full [&_[data-slot=playback-player]:not(.fixed)]:max-w-[calc(100cqh*16/9)] [&_[data-slot=playback-player]:not(.fixed)]:rounded-none [&_[data-slot=playback-player]:not(.fixed)]:border-0 [&_[data-slot=playback-player]:not(.fixed)]:shadow-none max-[800px]:h-[min(24dvh,13rem)] max-[800px]:flex-none min-[640px]:max-[800px]:h-[min(34dvh,22rem)]">
						<Playback.Player>
							{#snippet empty({ hasQueuedMedia })}
								<div class="flex aspect-video flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,var(--stage-glow),transparent_70%)] p-4 text-center">
									<div class="mb-5 text-(--stage-empty-icon) max-[800px]:mb-2"><Headphones class="max-[800px]:size-[22px]" size={32} strokeWidth={1.4} /></div>
									<h2 class="font-heading text-[clamp(1rem,2vw,1.8rem)] font-[550] tracking-[-.04em]">{hasQueuedMedia ? "Your music is on its way." : "Good company. Great music."}</h2>
									<p class="mt-2 max-w-80 text-[.8rem] leading-[1.6] text-(--stage-subtle) max-[800px]:max-w-68 max-[800px]:text-[.65rem]">{hasQueuedMedia ? "The next ready song will start automatically." : "Every room starts with a song. Add one to the queue."}</p>
								</div>
							{/snippet}
						</Playback.Player>
					</div>
					<div class="flex items-center gap-[.875rem] p-5 max-[800px]:gap-[.6rem] max-[800px]:px-3 max-[800px]:py-[.6rem]">
						<div class="grid size-11 shrink-0 place-items-center rounded-[.8rem] bg-(--stage-icon-background) text-(--stage-accent) max-[800px]:size-8 max-[800px]:rounded-lg"><Music2 size={21} /></div>
						<div class="min-w-0">
							<Playback.NowPlaying>
								{#snippet children({ title, hasQueuedMedia })}
									<p class="mb-[.2rem] text-[.625rem] font-[650] tracking-[.14em] text-(--stage-subtle) uppercase max-[800px]:text-[.5rem]">{title ? "Now playing" : "Up next"}</p>
									<h2 class="overflow-hidden font-heading text-base font-[550] tracking-[-.02em] text-ellipsis whitespace-nowrap max-[800px]:text-[.8rem]" title={title ?? undefined}>{title ?? (hasQueuedMedia ? "Preparing the next song…" : "Your first song goes here")}</h2>
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
