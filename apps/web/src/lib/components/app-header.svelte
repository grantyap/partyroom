<script lang="ts">
	import { goto, refreshAll } from "$app/navigation";
	import { page } from "$app/state";
	import { authClient } from "$lib/auth-client";
	import * as Avatar from "$lib/components/ui/avatar";
	import { Button } from "$lib/components/ui/button";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import * as Drawer from "$lib/components/ui/drawer";
	import { Input } from "$lib/components/ui/input";
	import {
		hasStoredUserName,
		setUserName,
		USER_NAME_MAX_LENGTH,
	} from "$lib/user-name";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
	import GalleryVerticalEndIcon from "@lucide/svelte/icons/gallery-vertical-end";
	import LogInIcon from "@lucide/svelte/icons/log-in";
	import LogOutIcon from "@lucide/svelte/icons/log-out";
	import PencilIcon from "@lucide/svelte/icons/pencil";
	import UserPlusIcon from "@lucide/svelte/icons/user-plus";

	type AppUser = {
		_id: string;
		name?: string | null;
		email?: string | null;
		image?: string | null;
		isAnonymous?: boolean | null;
	};

	let { user }: { user: AppUser | null } = $props();

	let signingOut = $state(false);
	let userNameInput = $state("");
	let userNameError = $state<string | null>(null);
	let savingUserName = $state(false);
	let locallySavedUserName = $state<string | null>(null);
	let locallySavedForUserId = $state<string | null>(null);
	let hasSetUserName = $state(false);
	let nameDialogOpen = $state(false);

	const isGuest = $derived(user?.isAnonymous === true);
	const currentUserName = $derived(
		user && locallySavedForUserId === user._id
			? (locallySavedUserName ?? user.name)
			: user?.name,
	);
	const canSetUserName = $derived(isGuest && !hasSetUserName);
	const displayName = $derived.by(() => {
		const name = currentUserName?.trim();
		if (name && !(isGuest && /^(anonymous|guest)$/i.test(name))) {
			return name;
		}

		return isGuest ? "Guest" : user?.email?.trim() || "Account";
	});
	const initial = $derived(displayName.slice(0, 1).toUpperCase() || "P");
	const returnTo = $derived(
		`${page.url.pathname}${page.url.search}${page.url.hash}`,
	);
	const signInHref = $derived(`/login?to=${encodeURIComponent(returnTo)}`);
	const signUpHref = $derived(`/sign-up?to=${encodeURIComponent(returnTo)}`);

	$effect(() => {
		const userId = user?._id;
		void currentUserName;
		hasSetUserName = Boolean(
			isGuest && userId && hasStoredUserName(userId),
		);
	});

	$effect(() => {
		if (!canSetUserName) {
			userNameInput = "";
			userNameError = null;
			nameDialogOpen = false;
		}
	});

	function openNameDialog() {
		if (!canSetUserName) return;

		userNameError = null;
		nameDialogOpen = true;
	}

	async function saveUserName(event: SubmitEvent) {
		event.preventDefault();
		const currentUser = user;
		if (savingUserName || !canSetUserName || !currentUser) return;

		savingUserName = true;
		userNameError = null;
		try {
			const name = await setUserName(userNameInput, currentUser._id);
			locallySavedForUserId = currentUser._id;
			locallySavedUserName = name;
			hasSetUserName = true;
			nameDialogOpen = false;
			await refreshAll({ includeLoadFunctions: true });
		} catch (cause) {
			userNameError =
				cause instanceof Error ? cause.message : "Unable to save your name";
		} finally {
			savingUserName = false;
		}
	}

	async function signOut() {
		if (signingOut) return;

		signingOut = true;
		try {
			const result = await authClient.signOut();
			if (result.error) {
				throw new Error(result.error.message);
			}

			await refreshAll({ includeLoadFunctions: true });
		} finally {
			signingOut = false;
		}
	}
</script>

<header
	class="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-40 border-b backdrop-blur"
>
	<div
		class="mx-auto flex h-16 w-full max-w-384 items-center justify-between gap-4 px-4 sm:px-6"
	>
		<div class="flex min-w-0 items-center gap-5">
			<a
				href="/app"
				class="flex shrink-0 items-center gap-2 font-medium text-foreground transition-opacity hover:opacity-75"
				aria-label="Partyroom rooms"
			>
				<div
					class="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-xl"
				>
					<GalleryVerticalEndIcon class="size-4" />
				</div>
				<span class="font-heading text-lg font-semibold tracking-tight"
					>Partyroom</span
				>
			</a>

			<nav
				class="hidden items-center gap-1 sm:flex"
				aria-label="App navigation"
			>
				<a
					href="/app"
					class="text-muted-foreground hover:bg-muted hover:text-foreground rounded-3xl px-3 py-2 text-sm font-medium transition-colors"
				>
					Rooms
				</a>
			</nav>
		</div>

		{#if user}
			<div class="flex items-center gap-1 sm:gap-2">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="hover:bg-muted focus-visible:ring-ring/50 flex min-w-0 items-center gap-2 rounded-3xl p-1.5 pe-2 transition-colors outline-none focus-visible:ring-3"
						aria-label={`Open ${isGuest ? "guest" : "account"} menu for ${displayName}`}
					>
						<Avatar.Root userId={user._id} class="size-7">
							{#if user.image}
								<Avatar.Image src={user.image} alt={displayName} />
							{/if}
							<Avatar.Fallback class="text-xs font-semibold">
								{initial}
							</Avatar.Fallback>
						</Avatar.Root>
						<span class="hidden max-w-40 truncate text-sm font-medium sm:inline">
							{displayName}
						</span>
						{#if isGuest}
							<CircleAlertIcon
								class="text-muted-foreground size-4"
								aria-hidden="true"
							/>
						{/if}
						<ChevronDownIcon class="text-muted-foreground size-4" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end">
						<DropdownMenu.Label class="max-w-64">
							<p class="truncate font-medium text-foreground">{displayName}</p>
							{#if isGuest}
								<p class="text-muted-foreground text-pretty text-xs">
									You're visiting as a guest. Create an account to keep your joined rooms.
								</p>
							{:else}
								<p class="truncate text-xs">{user.email || "Signed in"}</p>
							{/if}
						</DropdownMenu.Label>
						{#if canSetUserName}
							<DropdownMenu.Item onclick={openNameDialog}>
								<PencilIcon />
								Set name
							</DropdownMenu.Item>
						{/if}

						{#if isGuest}
							<DropdownMenu.Separator />
							<DropdownMenu.Item onclick={() => goto(signUpHref)}>
								<UserPlusIcon />
								Create account
							</DropdownMenu.Item>
							<DropdownMenu.Item onclick={() => goto(signInHref)}>
								<LogInIcon />
								Log in
							</DropdownMenu.Item>
						{:else}
							<DropdownMenu.Separator />
							<DropdownMenu.Item
								variant="destructive"
								disabled={signingOut}
								onclick={() => void signOut()}
							>
								<LogOutIcon />
								{signingOut ? "Logging out…" : "Log out"}
							</DropdownMenu.Item>
						{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<Drawer.Root bind:open={nameDialogOpen}>
					<Drawer.Content>
						<Drawer.Header class="text-start">
							<Drawer.Title>Set your name</Drawer.Title>
							<Drawer.Description>
								Choose the name other people in the room will see. You can only set it once.
							</Drawer.Description>
						</Drawer.Header>
						<form
							class="flex flex-col gap-4 px-4 pb-4"
							onsubmit={saveUserName}
						>
							<div class="space-y-2">
								<Input
									bind:value={userNameInput}
									maxlength={USER_NAME_MAX_LENGTH}
									placeholder="Your name"
									aria-label="Your name"
									autocomplete="nickname"
									autofocus
								/>
								{#if userNameError}
									<p class="text-xs text-destructive" role="alert">
										{userNameError}
									</p>
								{/if}
							</div>
							<Drawer.Footer class="p-0">
								<Button
									class="w-full"
									type="submit"
									disabled={savingUserName || !userNameInput.trim()}
								>
									{savingUserName ? "Saving…" : "Save name"}
								</Button>
							</Drawer.Footer>
						</form>
					</Drawer.Content>
				</Drawer.Root>
			</div>
		{:else}
			<div class="flex items-center gap-1 sm:gap-2">
				<Button href={signInHref} variant="ghost" size="sm">Log in</Button>
				<Button href={signUpHref} size="sm">Create account</Button>
			</div>
		{/if}
	</div>
</header>
