<script lang="ts">
	import { cn } from "$lib/utils";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		children,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		ref?: HTMLDivElement | null;
		children?: Snippet;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="room-tabs-scroll-area"
	class={cn("min-h-0 flex-1 overflow-y-auto", className)}
	{...restProps}
>
	{@render children?.()}
</div>
