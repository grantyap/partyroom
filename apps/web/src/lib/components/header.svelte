<script lang="ts">
	import { refreshAll } from "$app/navigation";
	import { authClient } from "$lib/auth-client";
	import { getCurrentUser } from "$lib/auth.remote";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";

	let user = $state(await getCurrentUser());

	async function signOut() {
		await authClient.signOut();
		user = null;
		await refreshAll({
			includeLoadFunctions: true,
		});
	}
</script>

<div>
	<div class="flex flex-row items-center justify-between px-4 py-2 md:px-6">
		<nav class="flex gap-4 text-lg w-full">
			<a href="/" class="hover:text-neutral-400 transition-colors">Home</a>
			<div class="flex-1">
				<!-- Spacer element. -->
			</div>
			{#if user}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{user.email}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content>
						<DropdownMenu.Item onclick={() => signOut()}>
							Log out
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{:else}
				<a href="/login" class="hover:text-neutral-400 transition-colors">
					Log in
				</a>
			{/if}
		</nav>
		<div class="flex items-center gap-2"></div>
	</div>
	<hr class="border-neutral-800" />
</div>
