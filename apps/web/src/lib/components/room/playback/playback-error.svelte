<!--
@component
Displays the current playback error from `Playback.Root`.

Use `<Playback.Error />` for the default alert. Add a `children` snippet to
change how an error is shown. It renders nothing when there is no error.

@see `Playback.Player` for the context-connected video player.

@example
```svelte
<Playback.Root {roomId}>
  <Playback.Error>
    {#snippet children({ error })}
      <div role="alert">Playback failed: {error}</div>
    {/snippet}
  </Playback.Error>
</Playback.Root>
```
-->
<script lang="ts" module>
	export type ErrorRenderProps = {
		error: string;
	};
</script>

<script lang="ts">
	import { cn } from "$lib/utils";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { usePlayback } from "./context.svelte";

	let {
		children,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLParagraphElement> & {
		children?: Snippet<[ErrorRenderProps]>;
	} = $props();

	const playbackContext = usePlayback();
</script>

{#if playbackContext.error}
	{#if children}
		{@render children({ error: playbackContext.error })}
	{:else}
		<p
			data-slot="playback-error"
			class={cn("text-xs text-destructive", className)}
			role="alert"
			{...restProps}
		>
			{playbackContext.error}
		</p>
	{/if}
{/if}
