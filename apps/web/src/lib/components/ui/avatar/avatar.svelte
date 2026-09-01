<script lang="ts">
	import { Avatar as AvatarPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";
	import { getMemberColors } from "$lib/member-colors";

	let {
		ref = $bindable(null),
		loadingStatus = $bindable("loading"),
		size = "default",
		class: className,
		style: customStyle,
		userId,
		...restProps
	}: AvatarPrimitive.RootProps & {
		size?: "default" | "sm" | "lg";
		userId?: string | null;
	} = $props();

	const memberColors = $derived(userId ? getMemberColors(userId) : null);
	const avatarStyle = $derived.by(() => {
		if (!memberColors) return customStyle;

		return [
			customStyle,
			`--avatar-fill: ${memberColors.fill}`,
			`--avatar-foreground: ${memberColors.foreground}`,
			`border-color: ${memberColors.accent}`,
		]
			.filter(Boolean)
			.join("; ");
	});
</script>

<AvatarPrimitive.Root
	bind:ref
	bind:loadingStatus
	data-slot="avatar"
	data-size={size}
	class={cn(
		"size-8 rounded-full after:rounded-full data-[size=lg]:size-10 data-[size=sm]:size-6 after:border-border group/avatar relative flex shrink-0 select-none after:absolute after:inset-0 after:border after:mix-blend-darken dark:after:mix-blend-lighten",
		userId ? "border-2" : "",
		className
	)}
	style={avatarStyle}
	{...restProps}
/>
