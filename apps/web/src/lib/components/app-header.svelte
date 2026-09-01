<script lang="ts">
	import { goto, refreshAll } from "$app/navigation";
	import { page } from "$app/state";
	import { authClient } from "$lib/auth-client";
	import * as Avatar from "$lib/components/ui/avatar";
	import { Button } from "$lib/components/ui/button";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import GalleryVerticalEndIcon from "@lucide/svelte/icons/gallery-vertical-end";
	import LogInIcon from "@lucide/svelte/icons/log-in";
	import LogOutIcon from "@lucide/svelte/icons/log-out";
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

	const isGuest = $derived(user?.isAnonymous === true);
	const displayName = $derived.by(() => {
		const name = user?.name?.trim();
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
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="hover:bg-muted focus-visible:ring-ring/50 flex min-w-0 items-center gap-2 rounded-3xl p-1.5 pe-2 transition-colors outline-none focus-visible:ring-3"
					aria-label={`Open account menu for ${displayName}`}
				>
					<Avatar.Root userId={user._id} class="size-7">
						{#if user.image}
							<Avatar.Image src={user.image} alt={displayName} />
						{/if}
						<Avatar.Fallback class="text-xs font-semibold"
							>{initial}</Avatar.Fallback
						>
					</Avatar.Root>
					<span class="hidden max-w-40 truncate text-sm font-medium sm:inline">
						{displayName}
					</span>
					{#if isGuest}
						<span class="text-muted-foreground hidden text-xs md:inline"
							>Guest</span
						>
					{/if}
					<ChevronDownIcon class="text-muted-foreground size-4" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Label class="max-w-64">
						<p class="truncate font-medium text-foreground">{displayName}</p>
						<p class="truncate text-xs">
							{isGuest ? "Guest session" : user.email || "Signed in"}
						</p>
					</DropdownMenu.Label>

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
					{/if}

					<DropdownMenu.Separator />
					<DropdownMenu.Item
						variant="destructive"
						disabled={signingOut}
						onclick={() => void signOut()}
					>
						<LogOutIcon />
						{signingOut ? "Logging out…" : "Log out"}
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{:else}
			<div class="flex items-center gap-1 sm:gap-2">
				<Button href={signInHref} variant="ghost" size="sm">Log in</Button>
				<Button href={signUpHref} size="sm">Create account</Button>
			</div>
		{/if}
	</div>
</header>
