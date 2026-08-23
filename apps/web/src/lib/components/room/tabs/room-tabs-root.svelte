<script lang="ts">
	import * as Card from "$lib/components/ui/card";
	import * as Tabs from "$lib/components/ui/tabs";
	import { cn } from "$lib/utils";
	import type { ComponentProps } from "svelte";

	type RootProps = ComponentProps<typeof Tabs.Root> & { cardClass?: string };

	let {
		ref = $bindable(null),
		value = $bindable(""),
		children,
		class: className,
		cardClass,
		...restProps
	}: RootProps = $props();
</script>

<div class="xl:relative xl:min-h-0" data-slot="room-tabs-root">
	<Card.Root
		class={cn(
			"h-[min(--spacing(96),70dvh)] gap-0 py-0 xl:absolute xl:inset-0 xl:h-auto",
			cardClass,
		)}
	>
		<Tabs.Root
			bind:ref
			bind:value
			class={cn("min-h-0 flex-1 gap-0 overflow-hidden", className)}
			{...restProps}
		>
			{@render children?.()}
		</Tabs.Root>
	</Card.Root>
</div>
