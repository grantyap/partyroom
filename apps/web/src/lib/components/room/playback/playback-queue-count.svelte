<script lang="ts">
	import { Badge } from "$lib/components/ui/badge";
	import { usePlayback } from "./context.svelte";

	const playbackContext = usePlayback();
	const count = $derived(playbackContext.playback?.queue.length ?? 0);
</script>

<Badge variant="secondary">{count}</Badge>
