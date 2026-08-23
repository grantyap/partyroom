<script lang="ts">
	import { cn } from "$lib/utils";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		children,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & { children?: Snippet } = $props();
</script>

<div
	data-slot="room-tabs-content-header"
	class={cn("shrink-0", className)}
	{...restProps}
>
	{@render children?.()}
</div>
