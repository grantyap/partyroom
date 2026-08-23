<script lang="ts">
	import {
		Avatar,
		AvatarFallback,
		AvatarImage,
	} from "$lib/components/ui/avatar";
	import { getMemberColors } from "$lib/member-colors";

	let {
		members,
	}: {
		members: Array<{
			userId: string;
			name?: string | null;
			username?: string | null;
			image?: string | null;
		}>;
	} = $props();
</script>

<section class="rounded-xl border bg-card p-4 shadow-sm">
	<h2 class="font-semibold">In the room</h2>
	<ul class="mt-3 space-y-3">
		{#each members as member (member.userId)}
			{@const memberColors = getMemberColors(member.userId)}
			<li class="flex items-center gap-2">
				<Avatar
					class="size-8 border-2"
					style={`border-color: ${memberColors.accent}`}
				>
					{#if member.image}<AvatarImage src={member.image} alt="" />{/if}
					<AvatarFallback
						style={`background-color: ${memberColors.fill}; color: ${memberColors.foreground}`}
						class="font-semibold"
					>
						{(member.name ?? "?").slice(0, 1).toUpperCase()}
					</AvatarFallback>
				</Avatar>
				<span
					class="truncate text-sm font-medium"
					style:color={memberColors.accent}
				>
					{member.name ?? member.username ?? "Guest"}
				</span>
			</li>
		{/each}
	</ul>
</section>
