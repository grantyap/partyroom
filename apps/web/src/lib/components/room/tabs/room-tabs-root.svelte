<script lang="ts">
	import * as Card from "$lib/components/ui/card";
	import * as Tabs from "$lib/components/ui/tabs";
	import { cn } from "$lib/utils";
	import type { ComponentProps } from "svelte";

	type RootProps = ComponentProps<typeof Tabs.Root> & { cardClass?: string; workspace?: boolean };

	let {
		ref = $bindable(null),
		value = $bindable(""),
		children,
		class: className,
		cardClass,
		workspace = false,
		...restProps
	}: RootProps = $props();
</script>

<div class={workspace ? "flex min-h-0 min-w-0 flex-col" : "min-w-0 xl:relative xl:min-h-0"} data-slot="room-tabs-root">
	<Card.Root
		class={cn(
			workspace
				? "min-h-0 flex-1 gap-0 rounded-2xl border py-0 shadow-none ring-0"
				: "h-[min(--spacing(96),70dvh)] gap-0 py-0 xl:absolute xl:inset-0 xl:h-auto",
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
