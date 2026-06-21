<script lang="ts">
	import type { PageProps } from "./$types";

	const { data }: PageProps = $props();
</script>

<pre class="text-muted-foreground text-xs">{JSON.stringify(data.user, null, 2)}</pre>
