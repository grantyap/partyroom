<script lang="ts">
	import * as Tabs from "$lib/components/ui/tabs";
	import { cn } from "$lib/utils";
	import type { ComponentProps } from "svelte";

	type ListProps = ComponentProps<typeof Tabs.List>;

	let {
		ref = $bindable(null),
		children,
		class: className,
		...restProps
	}: ListProps = $props();
</script>

<div class="shrink-0 border-b px-3 pt-1" data-slot="room-tabs-list">
	<Tabs.List bind:ref variant="line" class={cn("h-12 w-full p-0 [&>button]:text-xs", className)} {...restProps}>
		{@render children?.()}
	</Tabs.List>
</div>
