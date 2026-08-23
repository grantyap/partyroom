<script lang="ts">
	import {
		Avatar,
		AvatarFallback,
		AvatarGroup,
		AvatarGroupCount,
		AvatarImage,
	} from "$lib/components/ui/avatar";
	import * as Popover from "$lib/components/ui/popover";
	import { getMemberColors } from "$lib/member-colors";

	type Member = {
		userId: string;
		name?: string | null;
		username?: string | null;
		image?: string | null;
	};

	let { members }: { members: Member[] } = $props();

	const visibleMembers = $derived(members.slice(0, 3));
	const hiddenMemberCount = $derived(Math.max(0, members.length - 3));
	const peopleLabel = $derived(
		`${members.length} ${members.length === 1 ? "person" : "people"} in the room`,
	);
</script>

<Popover.Root>
	<Popover.Trigger
		openOnHover
		openDelay={350}
		closeDelay={200}
		class="inline-flex min-h-11 items-center rounded-full px-1 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
		aria-label={peopleLabel}
	>
		<AvatarGroup>
			{#if members.length === 0}
				<AvatarGroupCount class="size-7 text-xs">0</AvatarGroupCount>
			{/if}
			{#each visibleMembers as member (member.userId)}
				{@const memberColors = getMemberColors(member.userId)}
				<Avatar
					class="size-7 border-2"
					style={`border-color: ${memberColors.accent}`}
				>
					{#if member.image}<AvatarImage src={member.image} alt="" />{/if}
					<AvatarFallback
						style={`background-color: ${memberColors.fill}; color: ${memberColors.foreground}`}
						class="text-xs font-semibold"
					>
						{(member.name ?? member.username ?? "?").slice(0, 1).toUpperCase()}
					</AvatarFallback>
				</Avatar>
			{/each}
			{#if hiddenMemberCount > 0}
				<AvatarGroupCount class="size-7 text-xs">+{hiddenMemberCount}</AvatarGroupCount>
			{/if}
		</AvatarGroup>
	</Popover.Trigger>

	<Popover.Content side="top" align="start" sideOffset={8} class="max-h-80 w-64 gap-3 rounded-xl p-3">
		<Popover.Header class="gap-0.5">
			<Popover.Title>In this chat</Popover.Title>
			<Popover.Description>{peopleLabel}</Popover.Description>
		</Popover.Header>

		<ul class="-mx-1 space-y-1 overflow-y-auto px-1">
			{#each members as member (member.userId)}
				{@const memberColors = getMemberColors(member.userId)}
				<li class="flex items-center gap-2 rounded-lg px-1 py-1">
					<Avatar
						class="size-8 border-2"
						style={`border-color: ${memberColors.accent}`}
					>
						{#if member.image}<AvatarImage src={member.image} alt="" />{/if}
						<AvatarFallback
							style={`background-color: ${memberColors.fill}; color: ${memberColors.foreground}`}
							class="font-semibold"
						>
							{(member.name ?? member.username ?? "?").slice(0, 1).toUpperCase()}
						</AvatarFallback>
					</Avatar>
					<span class="truncate text-sm font-medium" style:color={memberColors.accent}>
						{member.name ?? member.username ?? "Guest"}
					</span>
				</li>
			{/each}
		</ul>
	</Popover.Content>
</Popover.Root>
