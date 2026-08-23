<script lang="ts">
	import type { OverlayMessage } from "../types";

	let { messages }: { messages: OverlayMessage[] } = $props();

	let initialized = false;
	let seenMessages = new Set<string>();
	let flyingMessages = $state<
		Array<OverlayMessage & { lane: number; duration: number }>
	>([]);

	$effect(() => {
		const incoming = messages;
		if (!initialized) {
			seenMessages = new Set(incoming.map(({ id }) => id));
			initialized = true;
			return;
		}
		for (const message of incoming) {
			if (seenMessages.has(message.id)) continue;
			seenMessages.add(message.id);
			const flying = {
				...message,
				lane: Math.floor(Math.random() * 6),
				duration: 7 + Math.random() * 4,
			};
			flyingMessages = [...flyingMessages, flying];
			setTimeout(() => {
				flyingMessages = flyingMessages.filter(({ id }) => id !== message.id);
			}, flying.duration * 1_000);
		}
	});
</script>

<div
	class="pointer-events-none absolute inset-x-0 top-0 z-20 aspect-video overflow-hidden"
	aria-hidden="true"
>
	{#each flyingMessages as message (message.id)}
		<p
			class="flying-message"
			style={`--lane: ${message.lane}; --duration: ${message.duration}s; --member-color: ${message.color}`}
		>
			{message.body}
		</p>
	{/each}
</div>

<style>
	.flying-message {
		position: absolute;
		top: calc(8% + var(--lane) * 11%);
		left: 100%;
		width: max-content;
		max-width: 80%;
		animation: fly var(--duration) linear forwards;
		color: var(--member-color);
		font-size: clamp(1rem, 2.2vw, 2rem);
		font-weight: 700;
		text-shadow:
			-2px -2px 0 rgb(0 0 0 / 0.9),
			2px -2px 0 rgb(0 0 0 / 0.9),
			-2px 2px 0 rgb(0 0 0 / 0.9),
			2px 2px 0 rgb(0 0 0 / 0.9);
	}

	@keyframes fly {
		from {
			transform: translateX(0);
		}
		to {
			transform: translateX(calc(-100vw - 100%));
		}
	}
</style>
