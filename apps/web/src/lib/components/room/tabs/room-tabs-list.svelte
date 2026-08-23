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

<div class="shrink-0 border-b p-3" data-slot="room-tabs-list">
	<Tabs.List bind:ref class={cn("w-full", className)} {...restProps}>
		{@render children?.()}
	</Tabs.List>
</div>
