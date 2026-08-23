<script lang="ts">
	import * as Tabs from "$lib/components/ui/tabs";
	import { cn } from "$lib/utils";
	import type { ComponentProps } from "svelte";

	type ContentProps = ComponentProps<typeof Tabs.Content>;

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: ContentProps = $props();
</script>

<Tabs.Content
	bind:ref
	class={cn("m-0 flex min-h-0 flex-col overflow-hidden", className)}
	{...restProps}
/>
