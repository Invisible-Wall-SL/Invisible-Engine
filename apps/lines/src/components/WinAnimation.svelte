<script lang="ts" module>
	/** One tier of a sequential-escalation chain: its spine bundle, count slot, and resolved
	 *  intro/idle/outro names. The single-tier path builds a one-element chain internally. */
	export type WinAnimationStep = {
		key: string;
		slotName: string;
		animationMap: { intro: string; idle: string; outro: string };
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	import { SpineProvider, SpineTrack, SpineSlot } from 'pixi-svelte';
	import { EDITOR_SPINE_LOAD_SCALE } from 'engine-layout';

	type AnimationState = 'intro' | 'idle' | 'outro';

	type Props = {
		// Resolved intro/idle/outro animation names for the active tier — the coded `winLevelMap`
		// convention by default, or author-picked per-tier/shared overrides (see `WIN_DEF`), so any
		// string the `winSpine` bundle exposes is valid (no longer the fixed convention literals).
		animationMap: {
			intro: string;
			idle: string;
			outro: string;
		};
		/** The big-win spine bundle + the slot the count number is injected into. Configurable so a
		 * game can point the shared `win` component at its own art; the coded defaults reproduce the
		 * original hardcodes (`bigwin` / `slot_win_count`), so an un-authored game renders identically. */
		key?: string;
		slotName?: string;
		/**
		 * OPTIONAL sequential-escalation chain (Invisible Game Config win tiers): the ordered tiers a
		 * win plays before the winning one. When present, this component plays each tier's intro+idle
		 * in sequence (advancing on the idle's `complete`), landing on the FINAL tier's looping idle;
		 * the final tier's OUTRO plays once {@link countUpComplete} latches. When ABSENT the component
		 * plays the single `animationMap` exactly as before (intro → looping idle, no outro) — the
		 * byte-identical un-escalating path. A tier may carry its own `key`, so bundles can differ.
		 */
		chain?: WinAnimationStep[];
		/** The count-up has finished — drives the FINAL tier's outro on the escalation path only. Inert
		 *  on the single-tier path (that idle loops until the overlay hides, as today). */
		countUpComplete?: boolean;
		/**
		 * Explicit display WIDTH for the rig (the spine is fitted to it). The coded/OFF composer
		 * passes the board width — the historical hardcode. The AUTHORED `win` componentInstance
		 * passes nothing, so the rig renders at its NATURAL size: the same base the Scene Editor
		 * previews it at, leaving the instance node's own scale as the single size knob (WYSIWYG).
		 */
		width?: number;
		children: Snippet;
	};

	const {
		animationMap,
		key = 'bigwin',
		slotName = 'slot_win_count',
		chain,
		countUpComplete = false,
		width,
		children,
	}: Props = $props();

	// The tiers to play. On the single-tier path (no `chain`) this is a ONE-element list built from the
	// props, so every branch below collapses to the original behaviour (byte-identical). On the
	// escalation path it is the authored chain, start → winning tier.
	const escalating = $derived(chain !== undefined);
	const steps = $derived<WinAnimationStep[]>(
		chain && chain.length ? chain : [{ key, slotName, animationMap }],
	);

	let stepIndex = $state(0);
	let animationState = $state<AnimationState>('intro');
	let oncomplete = $state(() => {});

	const current = $derived(steps[Math.min(stepIndex, steps.length - 1)]);
	const isFinalStep = $derived(stepIndex >= steps.length - 1);

	// The FINAL tier's idle LOOPS (during the count-up), exactly as the single-tier idle always has —
	// so the single-tier path is unchanged. A NON-final tier's idle plays ONE cycle (loop off) so its
	// `complete` fires and advances the chain to the next tier's intro.
	const idleLoops = $derived(animationState === 'idle' && isFinalStep);

	// Escalation only: once the (single, continuous) count-up completes, play the FINAL tier's outro.
	// Guarded on `escalating` so the single-tier path never gains an outro it did not have before.
	$effect(() => {
		if (escalating && countUpComplete && isFinalStep && animationState === 'idle') {
			animationState = 'outro';
		}
	});
</script>

<!--
	`loadScaleBase` on the natural-size (authored) path only: the editor previews EVERY rig at
	`EDITOR_SPINE_LOAD_SCALE`, while the game reads each bundle at whatever `parser.scale` its
	asset index declares (the engine-bundled `bigwin` is 2, an exported editor-art bundle is 1)
	— and Spine leaves `skeleton.data.width/height` un-scaled, so nothing downstream cancels
	that. Dividing it out is what makes "natural size" mean the same thing on both surfaces. The
	width-fitted OFF path is deliberately left alone: `parser.scale × width` is its shipped size.
-->
<SpineProvider
	{width}
	key={current.key}
	loadScaleBase={width === undefined ? EDITOR_SPINE_LOAD_SCALE : undefined}
>
	<SpineTrack
		trackIndex={0}
		animationName={current.animationMap[animationState]}
		loop={idleLoops}
		listener={{
			complete: () => {
				if (animationState === 'intro') {
					animationState = 'idle';
					return;
				}
				if (animationState === 'idle') {
					// A non-final tier's single idle cycle finished ⇒ escalate to the next tier's intro.
					// The final tier's idle loops (`idleLoops`), so its `complete` fires here and does
					// nothing — it keeps looping until `countUpComplete` flips it to the outro (above).
					if (!isFinalStep) {
						stepIndex += 1;
						animationState = 'intro';
					}
					return;
				}
				if (animationState === 'outro') oncomplete();
			},
		}}
	/>
	<SpineSlot slotName={current.slotName}>
		{@render children()}
	</SpineSlot>
</SpineProvider>
