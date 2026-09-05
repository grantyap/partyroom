<!--
@component
Internal sortable shell used by `Playback.QueueItem`.

@see `Playback.QueueItem` for the public queue item component.
-->
<script lang="ts">
	import { useSortable } from "@dnd-kit-svelte/svelte/sortable";
	import { GripVertical } from "@lucide/svelte";
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
	class="group flex items-center gap-2 rounded-xl px-2 py-3 transition-colors hover:bg-muted/60"
	class:opacity-50={isDragging.current}
>
	{#if !disabled}
		<button
			{@attach handleRef}
			type="button"
			class="relative grid size-8 shrink-0 touch-none cursor-grab place-items-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
			aria-label={`Reorder ${label}`}
		>
			<span class="text-xs tabular-nums group-hover:opacity-0 group-focus-within:opacity-0" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
			<GripVertical class="absolute size-4 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" aria-hidden="true" />
		</button>
	{:else}
		<span class="grid size-8 shrink-0 place-items-center text-xs text-muted-foreground tabular-nums" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
	{/if}
	{@render children()}
</li>
