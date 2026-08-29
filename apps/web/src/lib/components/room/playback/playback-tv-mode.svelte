<!--
@component
Displays the TV mode control for `Playback.Player`.

Use the default button or add a `children` snippet to provide your own control.

@see `Playback.Player` for the element shown in TV mode.

@example
```svelte
<Playback.TvMode>
  {#snippet children({ active, toggle })}
    <button onclick={toggle}>{active ? "Exit TV mode" : "TV mode"}</button>
  {/snippet}
</Playback.TvMode>
```
-->
<script lang="ts" module>
	export type TvModeRenderProps = {
		active: boolean;
		toggle: () => void;
	};
</script>

<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { Maximize2 } from "@lucide/svelte";
	import type { Snippet } from "svelte";
	import { usePlayback } from "./context.svelte";

	let { children }: { children?: Snippet<[TvModeRenderProps]> } = $props();

	const playbackContext = usePlayback();
	const renderProps: TvModeRenderProps = $derived({
		active: playbackContext.tvMode,
		toggle: () => void playbackContext.toggleTvMode(),
	});
</script>

{#if children}
	{@render children(renderProps)}
{:else}
	<Button
		variant="outline"
		size="sm"
		onclick={renderProps.toggle}
		aria-pressed={renderProps.active}
	>
		<Maximize2 /> TV mode
	</Button>
{/if}
