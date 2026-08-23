<script lang="ts">
	import * as Card from "$lib/components/ui/card";

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

<section>
	<Card.Root size="sm">
		<Card.Header>
			<Card.Title><h2>Visitor permissions</h2></Card.Title>
			<Card.Description
				>Choose what visitors can do in this room.</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#each permissionOptions as permission (permission.key)}
				<label
					class="flex cursor-pointer items-center justify-between gap-3 text-sm"
				>
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
		</Card.Content>
	</Card.Root>
</section>
