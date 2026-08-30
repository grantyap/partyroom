<!--
@component
Displays one-line content and scrolls it back and forth when it does not fit.
The scroll pauses at both ends and fades the content into transparency at the
leading edge while it moves.
-->
<script lang="ts" module>
	const HOLD_DURATION_MS = 1_600;
	const SCROLL_SPEED_PX_PER_MS = 0.032;
	const RAMP_DURATION_MS = 400;
	const ENDPOINT_FADE_DISTANCE_PX = 24;
	const FADE_TRANSITION_DURATION_MS = 180;
	const MAX_EDGE_FADE_PX = 24;
	const RAMP_SAMPLE_POINTS = [
		0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1,
	] as const;
	// Timers only schedule phase changes; CSS transitions perform the motion.

	type TextScrollerDirection = "forward" | "backward";
	type TextScrollerPhase = "start-hold" | TextScrollerDirection;
	type SharedTextScrollerListener = (phase: TextScrollerPhase) => void;
	type SharedTextScrollerEntry = {
		distance: number;
		listeners: Set<SharedTextScrollerListener>;
	};

	type SharedTextScrollerHandle = {
		getPhase: () => TextScrollerPhase;
		subscribe: (listener: SharedTextScrollerListener) => () => void;
		updateDistance: (distance: number) => void;
		release: () => void;
	};

	const sharedTextScrollerEntries = new Set<SharedTextScrollerEntry>();
	let sharedTextScrollerPhase: TextScrollerPhase = "start-hold";
	let sharedTextScrollerMaxDistance = 0;
	let sharedTextScrollerTimer: ReturnType<typeof setTimeout> | undefined;

	function getTravelDuration(distance: number) {
		// The fixed ramp is added to the constant-speed time so the middle of
		// every scroller's movement has the same physical speed.
		const constantSpeedDuration = distance / SCROLL_SPEED_PX_PER_MS;
		const rampDuration = Math.min(RAMP_DURATION_MS, constantSpeedDuration / 2);

		return constantSpeedDuration + rampDuration;
	}

	function getEndpointFadeTiming(distance: number) {
		const constantSpeedDuration = distance / SCROLL_SPEED_PX_PER_MS;
		const rampDuration = Math.min(RAMP_DURATION_MS, constantSpeedDuration / 2);
		const rampDistance = (SCROLL_SPEED_PX_PER_MS * rampDuration) / 2;
		const fadeDistance = Math.min(ENDPOINT_FADE_DISTANCE_PX, distance);
		const duration =
			(fadeDistance - rampDistance) / SCROLL_SPEED_PX_PER_MS + rampDuration;

		return {
			startDelay: getTravelDuration(distance) - duration,
			duration,
		};
	}

	function formatEasingValue(value: number) {
		return value.toFixed(6);
	}

	function getMoveTimingFunction(distance: number) {
		// Approximate smoothstep acceleration and deceleration with CSS linear()
		// stops while keeping the cruise segment exactly linear.
		const constantSpeedDuration = distance / SCROLL_SPEED_PX_PER_MS;
		const rampDuration = Math.min(RAMP_DURATION_MS, constantSpeedDuration / 2);
		const totalDuration = constantSpeedDuration + rampDuration;
		const rampTimeRatio = rampDuration / totalDuration;
		const rampDistanceRatio = rampDuration / constantSpeedDuration / 2;
		const stops: string[] = [];

		for (const point of RAMP_SAMPLE_POINTS.slice(0, -1)) {
			const distanceRatio =
				(rampDuration / constantSpeedDuration) *
				(point ** 3 - 0.5 * point ** 4);
			const timeRatio = point * rampTimeRatio;
			stops.push(
				`${formatEasingValue(distanceRatio)} ${formatEasingValue(timeRatio * 100)}%`,
			);
		}

		// Make the constant-speed segment explicit so the deceleration ramp
		// starts from its exact cruise speed instead of an interpolated stop.
		stops.push(
			`${formatEasingValue(rampDistanceRatio)} ${formatEasingValue(rampTimeRatio * 100)}%`,
		);
		stops.push(
			`${formatEasingValue(1 - rampDistanceRatio)} ${formatEasingValue((1 - rampTimeRatio) * 100)}%`,
		);

		for (const point of RAMP_SAMPLE_POINTS.slice(1)) {
			const distanceRatio =
				1 -
				rampDistanceRatio +
				(rampDuration / constantSpeedDuration) *
					(point - point ** 3 + 0.5 * point ** 4);
			const timeRatio = 1 - rampTimeRatio + point * rampTimeRatio;
			stops.push(
				`${formatEasingValue(distanceRatio)} ${formatEasingValue(timeRatio * 100)}%`,
			);
		}

		return `linear(${stops.join(", ")})`;
	}

	function notifySharedTextScrollers() {
		for (const entry of sharedTextScrollerEntries) {
			for (const listener of entry.listeners) {
				listener(sharedTextScrollerPhase);
			}
		}
	}

	function getSharedTextScrollerMaxDistance() {
		return Math.max(
			0,
			...Array.from(sharedTextScrollerEntries, (entry) => entry.distance),
		);
	}

	function clearSharedTextScrollerTimer() {
		if (sharedTextScrollerTimer === undefined) return;
		clearTimeout(sharedTextScrollerTimer);
		sharedTextScrollerTimer = undefined;
	}

	function scheduleSharedTextScrollerPhase() {
		clearSharedTextScrollerTimer();
		sharedTextScrollerTimer = setTimeout(
			() => {
				sharedTextScrollerTimer = undefined;
				sharedTextScrollerPhase =
					sharedTextScrollerPhase === "start-hold"
						? "forward"
						: sharedTextScrollerPhase === "forward"
							? "backward"
							: "start-hold";
				notifySharedTextScrollers();
				scheduleSharedTextScrollerPhase();
			},
			sharedTextScrollerPhase === "start-hold"
				? HOLD_DURATION_MS
				: getTravelDuration(sharedTextScrollerMaxDistance) + HOLD_DURATION_MS,
		);
	}

	function restartSharedTextScroller() {
		sharedTextScrollerMaxDistance = getSharedTextScrollerMaxDistance();
		sharedTextScrollerPhase = "start-hold";
		notifySharedTextScrollers();
		scheduleSharedTextScrollerPhase();
	}

	function acquireSharedTextScroller(
		distance: number,
	): SharedTextScrollerHandle {
		const entry: SharedTextScrollerEntry = {
			distance,
			listeners: new Set(),
		};
		sharedTextScrollerEntries.add(entry);
		restartSharedTextScroller();

		let released = false;
		return {
			getPhase() {
				return sharedTextScrollerPhase;
			},
			subscribe(listener) {
				entry.listeners.add(listener);
				listener(sharedTextScrollerPhase);
				return () => entry.listeners.delete(listener);
			},
			updateDistance(nextDistance) {
				if (released || entry.distance === nextDistance) return;
				entry.distance = nextDistance;
				restartSharedTextScroller();
			},
			release() {
				if (released) return;
				released = true;
				sharedTextScrollerEntries.delete(entry);
				if (sharedTextScrollerEntries.size === 0) {
					clearSharedTextScrollerTimer();
					sharedTextScrollerMaxDistance = 0;
					sharedTextScrollerPhase = "start-hold";
					return;
				}
				if (
					getSharedTextScrollerMaxDistance() !== sharedTextScrollerMaxDistance
				) {
					restartSharedTextScroller();
				}
			},
		};
	}
</script>

<script lang="ts">
	import { cn, type WithoutChildren } from "$lib/utils";
	import { onMount, type Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type TextScrollerProps = WithoutChildren<HTMLAttributes<HTMLDivElement>> & {
		children?: Snippet;
		/**
		 * Share a movement schedule with other `TextScroller` instances. `true` by default.
		 * Pass `false` when an instance should use its own timing.
		 */
		sync?: boolean;
	};

	let {
		children,
		sync = true,
		class: className,
		style: styleValue,
		...restProps
	}: TextScrollerProps = $props();

	let viewport = $state<HTMLDivElement | null>(null);
	let track = $state<HTMLDivElement | null>(null);
	let mounted = $state(false);
	let isOverflowing = $state(false);
	let scrollDistance = $state(0);
	let moveDirection = $state<TextScrollerDirection>("backward");
	let moveDuration = $state(0);
	let moveTimingFunction = $state("linear");
	let edgeFade = $state(0);
	let fadeTransitionDuration = $state(0);
	let fadeMode = $state<"start" | "moving" | "end">("start");

	let resizeObserver: ResizeObserver | undefined;
	let measureFrame: number | undefined;
	let phaseTimer: ReturnType<typeof setTimeout> | undefined;
	let sharedSync: SharedTextScrollerHandle | undefined;
	let unsubscribeSharedSync: (() => void) | undefined;
	let measuredDistance = 0;
	let measuredSync: boolean | undefined;

	const scrollerStyle = $derived(
		`${styleValue ? `${styleValue}; ` : ""}--text-scroller-distance: ${scrollDistance}px; --text-scroller-translate: ${moveDirection === "forward" ? -scrollDistance : 0}px; --text-scroller-move-duration: ${moveDuration}ms; --text-scroller-move-timing: ${moveTimingFunction}; --text-scroller-fade-duration: ${fadeTransitionDuration}ms; --text-scroller-edge-fade: ${edgeFade}px; --text-scroller-fade-left: ${fadeMode === "start" ? 0 : edgeFade}px; --text-scroller-fade-right: ${fadeMode === "end" ? 0 : edgeFade}px;`,
	);

	function clearPhaseTimer() {
		if (phaseTimer === undefined) return;
		clearTimeout(phaseTimer);
		phaseTimer = undefined;
	}

	function releaseSharedSync() {
		clearPhaseTimer();
		unsubscribeSharedSync?.();
		unsubscribeSharedSync = undefined;
		sharedSync?.release();
		sharedSync = undefined;
	}

	function scheduleEndpointFade(direction: TextScrollerDirection) {
		clearPhaseTimer();
		const { startDelay, duration } = getEndpointFadeTiming(scrollDistance);
		phaseTimer = setTimeout(() => {
			phaseTimer = undefined;
			fadeTransitionDuration = duration;
			fadeMode = direction === "forward" ? "end" : "start";
		}, startDelay);
	}

	function beginMovement(direction: TextScrollerDirection) {
		moveDirection = direction;
		moveDuration = getTravelDuration(scrollDistance);
		moveTimingFunction = getMoveTimingFunction(scrollDistance);
		fadeTransitionDuration = FADE_TRANSITION_DURATION_MS;
		fadeMode = "moving";
	}

	function beginOwnMovement(direction: TextScrollerDirection) {
		clearPhaseTimer();
		beginMovement(direction);
		const { startDelay, duration } = getEndpointFadeTiming(scrollDistance);
		phaseTimer = setTimeout(() => {
			phaseTimer = undefined;
			fadeTransitionDuration = duration;
			fadeMode = direction === "forward" ? "end" : "start";
			phaseTimer = setTimeout(() => {
				phaseTimer = undefined;
				phaseTimer = setTimeout(() => {
					phaseTimer = undefined;
					beginOwnMovement(direction === "forward" ? "backward" : "forward");
				}, HOLD_DURATION_MS);
			}, duration);
		}, startDelay);
	}

	function beginOwnStartHold() {
		clearPhaseTimer();
		moveDirection = "backward";
		moveDuration = 0;
		moveTimingFunction = "linear";
		fadeTransitionDuration = 0;
		fadeMode = "start";
		phaseTimer = setTimeout(() => {
			phaseTimer = undefined;
			beginOwnMovement("forward");
		}, HOLD_DURATION_MS);
	}

	function applySharedPhase(phase: TextScrollerPhase) {
		clearPhaseTimer();
		if (phase === "start-hold") {
			moveDirection = "backward";
			moveDuration = 0;
			moveTimingFunction = "linear";
			fadeTransitionDuration = 0;
			fadeMode = "start";
			return;
		}

		beginMovement(phase);
		scheduleEndpointFade(phase);
	}

	function configureScroller(distance: number, nextEdgeFade: number) {
		scrollDistance = distance;
		edgeFade = nextEdgeFade;

		if (sync) {
			if (sharedSync === undefined) {
				sharedSync = acquireSharedTextScroller(distance);
				unsubscribeSharedSync = sharedSync.subscribe(applySharedPhase);
			} else {
				sharedSync.updateDistance(distance);
				applySharedPhase(sharedSync.getPhase());
			}
			return;
		}

		releaseSharedSync();
		beginOwnStartHold();
	}

	function measure() {
		if (!viewport || !track) return;

		const nextDistance = Math.max(
			0,
			Math.ceil(track.scrollWidth - viewport.clientWidth),
		);
		const nextIsOverflowing = nextDistance > 0;
		const nextEdgeFade = Math.min(MAX_EDGE_FADE_PX, viewport.clientWidth * 0.2);
		const wasOverflowing = isOverflowing;
		const distanceChanged = measuredDistance !== nextDistance;
		const syncChanged = measuredSync !== sync;

		measuredDistance = nextDistance;
		measuredSync = sync;
		isOverflowing = nextIsOverflowing;

		if (!nextIsOverflowing) {
			releaseSharedSync();
			scrollDistance = 0;
			moveDirection = "backward";
			moveDuration = 0;
			moveTimingFunction = "linear";
			fadeTransitionDuration = 0;
			edgeFade = 0;
			fadeMode = "start";
			return;
		}

		if (!wasOverflowing || distanceChanged || syncChanged) {
			configureScroller(nextDistance, nextEdgeFade);
		} else {
			edgeFade = nextEdgeFade;
		}
	}

	function scheduleMeasure() {
		if (!mounted || measureFrame !== undefined) return;

		measureFrame = requestAnimationFrame(() => {
			measureFrame = undefined;
			measure();
		});
	}

	$effect(() => {
		// oxlint-disable-next-line no-unused-expressions -- Used for reactivity.
		children;
		// oxlint-disable-next-line no-unused-expressions -- Used for reactivity.
		sync;
		if (mounted) scheduleMeasure();
	});

	onMount(() => {
		mounted = true;
		resizeObserver = new ResizeObserver(scheduleMeasure);
		if (viewport) resizeObserver.observe(viewport);
		if (track) resizeObserver.observe(track);
		scheduleMeasure();

		return () => {
			mounted = false;
			if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
			resizeObserver?.disconnect();
			clearPhaseTimer();
			releaseSharedSync();
		};
	});
</script>

<div
	bind:this={viewport}
	data-slot="text-scroller"
	data-scrolling={isOverflowing ? "true" : undefined}
	class={cn("text-scroller", className)}
	style={scrollerStyle}
	{...restProps}
>
	<div bind:this={track} class="text-scroller__track">
		{@render children?.()}
	</div>
</div>

<style>
	@property --text-scroller-fade-left {
		syntax: "<length>";
		inherits: false;
		initial-value: 0px;
	}

	@property --text-scroller-fade-right {
		syntax: "<length>";
		inherits: false;
		initial-value: 0px;
	}

	.text-scroller {
		--text-scroller-edge-fade: 0px;
		--text-scroller-fade-left: 0px;
		--text-scroller-fade-right: 0px;
		--text-scroller-fade-duration: 0ms;
		--text-scroller-move-duration: 0ms;
		--text-scroller-move-timing: linear;
		--text-scroller-translate: 0px;
		display: block;
		max-width: 100%;
		min-width: 0;
		overflow: hidden;
	}

	.text-scroller__track {
		display: block;
		width: max-content;
		white-space: nowrap;
		transform: translate3d(var(--text-scroller-translate), 0, 0);
		transition: transform var(--text-scroller-move-duration) linear;
		transition: transform var(--text-scroller-move-duration)
			var(--text-scroller-move-timing);
	}

	.text-scroller[data-scrolling="true"] {
		mask-mode: alpha;
		mask-image: linear-gradient(
			to right,
			transparent 0,
			#000 var(--text-scroller-fade-left),
			#000 calc(100% - var(--text-scroller-fade-right)),
			transparent 100%
		);
		mask-position: 0 0;
		mask-repeat: no-repeat;
		mask-size: 100% 100%;
		-webkit-mask-mode: alpha;
		-webkit-mask-image: linear-gradient(
			to right,
			transparent 0,
			#000 var(--text-scroller-fade-left),
			#000 calc(100% - var(--text-scroller-fade-right)),
			transparent 100%
		);
		-webkit-mask-position: 0 0;
		-webkit-mask-repeat: no-repeat;
		-webkit-mask-size: 100% 100%;
		transition:
			--text-scroller-fade-left var(--text-scroller-fade-duration) ease,
			--text-scroller-fade-right var(--text-scroller-fade-duration) ease;
	}

	.text-scroller[data-scrolling="true"] .text-scroller__track {
		will-change: transform;
	}

	@media (prefers-reduced-motion: reduce) {
		.text-scroller[data-scrolling="true"] {
			--text-scroller-translate: 0px !important;
			--text-scroller-fade-left: 0px !important;
			--text-scroller-fade-right: var(--text-scroller-edge-fade) !important;
			transition: none;
		}

		.text-scroller[data-scrolling="true"] .text-scroller__track {
			transition: none;
		}
	}
</style>
