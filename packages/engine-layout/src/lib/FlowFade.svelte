<script lang="ts" module>
	import type { Snippet } from 'svelte';

	/**
	 * The ENTRANCE transition the Invisible Flow interpreter surfaced for a screen's activation
	 * (design doc §6, the droppable "Transition" node). Present ⇒ fade the wrapped content in;
	 * absent ⇒ a HARD CUT (render at full alpha, byte-identical to today's instant mount, §7).
	 * Structural, so engine-layout needn't depend on engine-flow's `FlowTransitionEffect` here.
	 */
	export type FlowEntranceTransition = {
		kind: 'fade';
		ms: number;
		easing?: 'linear' | 'easeOut' | 'easeInOut';
	};

	export type Props = {
		/** The entrance transition for this content's activation. Present ⇒ mount HIDDEN (alpha 0)
		 *  and tween alpha→1 over `ms` (scaled by `timeScale`) with the mapped easing — the fade
		 *  starts from the FIRST painted frame, so there is NO full-alpha flash. Absent ⇒ render
		 *  the content directly at alpha 1 (a hard cut — parity §7). */
		transition?: FlowEntranceTransition;
		/** The live turbo scalar (`() => stateBet.isTurbo ? 2 : 1`). The fade duration is divided
		 *  by it like a choreography `Delay` / a transition `delayMs`. Absent ⇒ 1 (no scaling). */
		timeScale?: () => number;
		/** The content to fade in (a `<LayoutScene>`, the HUD `<UI>` chrome, …). */
		children: Snippet;
	};
</script>

<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { linear, cubicOut, cubicInOut } from 'svelte/easing';
	import { Container } from 'pixi-svelte';

	const { transition, timeScale, children }: Props = $props();

	// Map the bounded authoring easing onto the codebase-native `svelte/motion` easing set (the
	// same tween primitive `FadeContainer` uses). A closed mapping — NOT a scripting language.
	const easingFn = (name: FlowEntranceTransition['easing']) =>
		name === 'easeOut' ? cubicOut : name === 'easeInOut' ? cubicInOut : linear;

	const durationMs = transition ? transition.ms / (timeScale?.() ?? 1) : 0;

	// Start HIDDEN so the very first painted frame is transparent — this is what avoids the flash.
	const alpha = new Tween(transition ? 0 : 1, {
		duration: durationMs,
		easing: easingFn(transition?.easing),
	});

	$effect(() => {
		if (transition) void alpha.set(1);
	});
</script>

{#if transition}
	<Container alpha={alpha.current}>
		{@render children()}
	</Container>
{:else}
	{@render children()}
{/if}
