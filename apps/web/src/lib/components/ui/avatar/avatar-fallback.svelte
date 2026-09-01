<script lang="ts">
	import { Avatar as AvatarPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		style: customStyle,
		...restProps
	}: AvatarPrimitive.FallbackProps = $props();

	const fallbackStyle = $derived(
		`background-color: var(--avatar-fill, var(--muted)); color: var(--avatar-foreground, var(--muted-foreground));${customStyle ? ` ${customStyle}` : ""}`,
	);
</script>

<AvatarPrimitive.Fallback
	bind:ref
	data-slot="avatar-fallback"
	class={cn(
		"bg-muted text-muted-foreground rounded-full flex size-full items-center justify-center text-sm group-data-[size=sm]/avatar:text-xs",
		className
	)}
	style={fallbackStyle}
	{...restProps}
/>
