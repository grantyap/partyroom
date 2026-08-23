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
		onChange: (permission: keyof MemberPermissions, enabled: boolean) => void;
	} = $props();

	const permissionOptions: Array<{
		key: keyof MemberPermissions;
		label: string;
	}> = [
		{ key: "controlPlayback", label: "Control playback" },
		{ key: "addToQueue", label: "Add songs" },
		{ key: "reorderQueue", label: "Reorder queue" },
		{ key: "removeFromQueue", label: "Remove queued songs" },
		{ key: "sendChat", label: "Send chat messages" },
	];
</script>

<section class="rounded-xl border bg-card p-4 shadow-sm">
	<h2 class="font-semibold">Visitor permissions</h2>
	<p class="mt-1 text-xs text-muted-foreground">
		Choose what visitors can do in this room.
	</p>
	<div class="mt-3 space-y-3">
		{#each permissionOptions as permission (permission.key)}
			<label class="flex cursor-pointer items-center justify-between gap-3 text-sm">
				<span>{permission.label}</span>
				<input
					type="checkbox"
					class="size-4 accent-primary"
					checked={permissions[permission.key]}
					onchange={(event) =>
						onChange(permission.key, event.currentTarget.checked)}
				/>
			</label>
		{/each}
	</div>
</section>
