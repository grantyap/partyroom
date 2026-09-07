<script lang="ts">

	type MemberPermissions = {
		controlPlayback: boolean;
		addToQueue: boolean;
		reorderQueue: boolean;
		removeFromQueue: boolean;
		sendChat: boolean;
	};

	let {
		permissions,
		onChange,
	}: {
		permissions: MemberPermissions;
		onChange: (permission: keyof MemberPermissions, enabled: boolean) => void | Promise<void>;
	} = $props();

	let saving = $state(false);
	let error = $state<string | null>(null);

	async function toggle(permission: keyof MemberPermissions) {
		if (saving) return;
		saving = true;
		error = null;
		try {
			await onChange(permission, !permissions[permission]);
		} catch {
			error = "Could not save that setting. Please try again.";
		} finally {
			saving = false;
		}
	}

	const permissionOptions: Array<{
		key: keyof MemberPermissions;
		label: string;
		description: string;
	}> = [
		{ key: "controlPlayback", label: "Control playback", description: "Play, pause, seek, skip songs, and change lyrics source and timing." },
		{ key: "addToQueue", label: "Add songs", description: "Let everyone contribute to the queue." },
		{ key: "reorderQueue", label: "Reorder queue", description: "Move songs up or down the list." },
		{ key: "removeFromQueue", label: "Remove songs", description: "Take a song out of the queue." },
		{ key: "sendChat", label: "Chat", description: "Share messages with the room." },
	];
</script>

<section aria-label="Visitor permissions" aria-busy={saving}>
	<div class="divide-y">
		{#each permissionOptions as permission (permission.key)}
			<div class="flex items-center justify-between gap-4 py-3.5">
				<div>
					<p class="text-sm font-medium">{permission.label}</p>
					<p class="mt-1 text-xs leading-relaxed text-muted-foreground">{permission.description}</p>
				</div>
				<button
					type="button"
					role="switch"
					aria-label={permission.label}
					aria-checked={permissions[permission.key]}
					disabled={saving}
					onclick={() => void toggle(permission.key)}
					class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-muted transition-colors before:absolute before:-inset-2 aria-checked:bg-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:opacity-50"
				>
					<span class="size-4 rounded-full bg-white shadow-sm transition-transform" class:translate-x-6={permissions[permission.key]} class:translate-x-1={!permissions[permission.key]}></span>
				</button>
			</div>
		{/each}
	</div>
	{#if error}<p class="mt-3 text-xs text-destructive" role="alert">{error}</p>{/if}
</section>
