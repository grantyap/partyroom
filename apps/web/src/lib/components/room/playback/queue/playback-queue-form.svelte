<!--
@component
Displays the form for adding a song to the queue.

Use this inside `Playback.Root` when you want to place the add-song form in a
custom queue layout. It renders nothing when the current user cannot add songs.

@see `Playback.Queue` for the complete default queue.
@see `Playback.QueueList` for the sortable list.

@example
```svelte
<Playback.QueueForm class="border-b p-3" />
```
-->
<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { cn } from "$lib/utils";
	import { Plus } from "@lucide/svelte";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import { useAction } from "convex-svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { usePlayback } from "../context.svelte";

	let {
		class: className,
		...restProps
	}: HTMLAttributes<HTMLDivElement> = $props();

	const playbackContext = usePlayback();
	const requestMedia = useAction(api.media.actions.requestMedia);

	let sourceUrl = $state("");
	let submitting = $state(false);
	let error = $state<string | null>(null);

	async function addSong(event: SubmitEvent) {
		event.preventDefault();
		if (!sourceUrl.trim() || submitting) return;
		submitting = true;
		error = null;
		try {
			await requestMedia({
				roomId: playbackContext.roomId,
				url: sourceUrl.trim(),
			});
			sourceUrl = "";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Unable to add song";
		} finally {
			submitting = false;
		}
	}
</script>

{#if playbackContext.playback?.permissions.addToQueue}
	<div data-slot="playback-queue-form" class={cn(className)} {...restProps}>
		<form class="flex gap-2" onsubmit={addSong}>
			<Input
				type="url"
				placeholder="Paste a video link…"
				aria-label="Video URL"
				bind:value={sourceUrl}
				disabled={submitting}
			/>
			<Button
				size="default"
				type="submit"
				disabled={submitting || !sourceUrl.trim()}
				aria-label="Add song"
			>
				<Plus aria-hidden="true" />
				<span>{submitting ? "Adding…" : "Add song"}</span>
			</Button>
		</form>
		{#if error}
			<p class="mt-2 text-xs text-destructive" role="alert">{error}</p>
		{/if}
	</div>
{/if}
