<script lang="ts">
	import { GripVertical } from "@lucide/svelte";
	import { useSortable } from "@dnd-kit-svelte/svelte/sortable";
	import type { Snippet } from "svelte";

	let {
		id,
		index,
		label,
		disabled = false,
		children,
	}: {
		id: string;
		index: number;
		label: string;
		disabled?: boolean;
		children: Snippet;
	} = $props();

	const { ref, handleRef, isDragging } = useSortable({
		id: () => id,
		index: () => index,
		disabled: () => disabled,
	});
</script>

<li
	{@attach ref}
	class="group flex items-center gap-2 rounded-lg border bg-background p-2"
	class:opacity-50={isDragging.current}
>
	{#if !disabled}
		<button
			{@attach handleRef}
			type="button"
			class="shrink-0 touch-none cursor-grab rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
			aria-label={`Reorder ${label}`}
		>
			<GripVertical class="size-4" aria-hidden="true" />
		</button>
	{/if}
	{@render children()}
</li>
