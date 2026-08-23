<script lang="ts">
	import * as Tabs from "$lib/components/ui/tabs";
	import { cn } from "$lib/utils";
	import type { ComponentProps } from "svelte";

	type RootProps = ComponentProps<typeof Tabs.Root>;

	let {
		ref = $bindable(null),
		value = $bindable(""),
		children,
		class: className,
		...restProps
	}: RootProps = $props();
</script>

<div class="xl:relative xl:min-h-0" data-slot="room-tabs-root">
	<Tabs.Root
		bind:ref
		bind:value
		class={cn(
			"h-[min(--spacing(96),70dvh)] min-h-0 gap-0 overflow-hidden rounded-xl border bg-card shadow-sm xl:absolute xl:inset-0 xl:h-auto",
			className,
		)}
		{...restProps}
	>
		{@render children?.()}
	</Tabs.Root>
</div>
