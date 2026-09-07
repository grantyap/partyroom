<!--
@component
Provides shared playback data and actions to child `Playback.*` components.

This component does not render an element or apply layout styles. Put any
playback components inside it, and add your own wrapper when you need a grid,
spacing, or other layout.

@see `Playback.Player` for the video player.
@see `Playback.NowPlaying` for the current song.

@example
```svelte
<Playback.Root {roomId}>
  <div class="grid gap-5 lg:grid-cols-2">
    <Playback.Player />
    <Playback.Queue />
  </div>
</Playback.Root>
```
-->
<script lang="ts">
	import { OnlineTimingObject } from "$lib/timing";
	import { api } from "@partyroom/backend/convex/_generated/api";
	import type { Id } from "@partyroom/backend/convex/_generated/dataModel";
	import { useAction, useMutation, useQuery } from "convex-svelte";
	import { onMount, type Snippet } from "svelte";
	import type { OverlayMessage } from "../types";
	import { setPlaybackContext } from "./context.svelte";

	let {
		roomId,
		overlayMessages,
		children,
	}: {
		roomId: Id<"rooms">;
		overlayMessages?: OverlayMessage[];
		children?: Snippet;
	} = $props();

	const playback = useQuery(api.playback.get, () => ({ roomId }));
	const roomMedia = useQuery(api.media.jobs.listRoomMedia, () => ({
		roomId,
		queuedOnly: true,
	}));
	const serverClock = useAction(api.playback.clock);
	const updateTiming = useMutation(api.playback.update);
	let error = $state<string | null>(null);

	const timing = new OnlineTimingObject({
		playStartDelaySeconds: 0,
		getProviderState: () =>
			playback.data
				? {
						vector: playback.data.playback.vector,
						revision: playback.data.playback.revision,
					}
				: undefined,
		readProviderClock: () => serverClock({}),
		updateProvider: async (vector, { playStartDelaySeconds }) => {
			const currentKey = playback.data?.current?._id;
			if (!currentKey) throw new Error("Nothing is playing");
			try {
				await updateTiming({
					roomId,
					currentKey,
					vector,
					playStartDelaySeconds,
				});
			} catch (cause) {
				error =
					cause instanceof Error
						? cause.message
						: "Unable to update playback";
				throw cause;
			}
		},
	});

	const mediaById = $derived(
		new Map((roomMedia.data ?? []).map((media) => [media._id, media])),
	);
	const currentMedia = $derived.by(() => {
		const current = playback.data?.current;
		if (!current) return undefined;

		const detail = mediaById.get(current.roomMedia);
		return {
			_id: current.roomMedia,
			title: current.title,
			duration: current.durationSeconds ?? undefined,
			finalUrl: current.finalUrl,
			lyrics: detail?.lyrics ?? [],
			selectedLyricsId: detail?.selectedLyricsId,
			lyricsOffsetMs: detail?.lyricsOffsetMs ?? 0,
		};
	});

	setPlaybackContext({
		roomId: () => roomId,
		playback: () => playback.data,
		mediaById: () => mediaById,
		currentMedia: () => currentMedia,
		overlayMessages: () => overlayMessages,
		error: () => error,
		timing,
	});

	onMount(() => timing.start());
</script>

{@render children?.()}
