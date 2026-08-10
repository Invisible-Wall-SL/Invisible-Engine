<script lang="ts" module>
	/** One tier of a sequential-escalation chain: its spine bundle, count slot, resolved
	 *  intro/idle/outro names, and the count-up AMOUNT (book units) at/above which this tier is reached
	 *  (`threshold × BOOK_AMOUNT_MULTIPLIER`). The single-tier path builds a one-element chain internally
	 *  (its boundary is unused — a single tier always shows). */
	export type WinAnimationStep = {
		key: string;
		slotName: string;
		animationMap: { intro: string; idle: string; outro: string };
		boundaryAmount: number;
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
		 * win plays before the winning one. When present, the COUNT is the clock — the active tier is
		 * derived from where the live {@link countUpAmount} sits against each tier's `boundaryAmount`
		 * (the first tier shows from the start; a later tier is entered once the count reaches its
		 * boundary), each tier plays its intro then LOOPS its idle, and the final tier's OUTRO plays once
		 * {@link countUpComplete} latches. Advancing the count (naturally or via the gate's tap-to-step
		 * seek) is what walks the tiers, so tiers and the number stay in sync. When ABSENT the component
		 * plays the single `animationMap` exactly as before (intro → looping idle, no outro) — the
		 * byte-identical un-escalating path. A tier may carry its own `key`, so bundles can differ.
		 */
		chain?: WinAnimationStep[];
		/** The live count-up amount (book units) — drives the escalation tier derivation (see `chain`).
		 *  Unused on the single-tier path. */
		countUpAmount?: number;
		/** The count-up has finished — drives the FINAL tier's outro on the escalation path only. Inert
		 *  on the single-tier path (that idle loops until the overlay hides, as today). When it latches
		 *  while the chain is still mid-walk (a fast-forward / tap-to-skip of the count-up), the chain
		 *  COLLAPSES to the final tier and plays its outro cleanly, so the escalation is never truncated. */
		countUpComplete?: boolean;
		/** Fired when the FINAL tier's OUTRO completes (escalation path only) — the gate awaits this before
		 *  concluding the presentation, so a collapsed/fast-forwarded chain still finishes its outro. Never
		 *  fires on the single-tier path (no outro), so that path is byte-identical. */
		onOutroComplete?: () => void;
		/** The live HOLD-to-fast-forward multiplier (the gate's `interactionSpeedScale`, 1 when not held).
		 *  Applied as a spine `timeScale` to the ESCALATION intro/idle tiers so they accelerate in lockstep
		 *  with the count-up while holding (a smooth ramp). Only used while escalating AND the walk is still
		 *  running (`!countUpComplete`); the outro + the single-tier path always play at 1× (byte-identical). */
		speedScale?: number;
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
		countUpAmount = 0,
		countUpComplete = false,
		onOutroComplete,
		speedScale = 1,
		width,
		children,
	}: Props = $props();

	// The tiers to play. On the single-tier path (no `chain`) this is a ONE-element list built from the
	// props, so every branch below collapses to the original behaviour (byte-identical). On the
	// escalation path it is the authored chain, start → winning tier.
	const escalating = $derived(chain !== undefined);
	const steps = $derived<WinAnimationStep[]>(
		chain && chain.length ? chain : [{ key, slotName, animationMap, boundaryAmount: 0 }],
	);

	let animationState = $state<AnimationState>('intro');

	// COUNT-DRIVEN tier (escalation path) — the active tier is the HIGHEST whose `boundaryAmount` the live
	// count has reached. The first tier (index 0) always shows from the start (its own boundary is ignored
	// — the win already reached the final tier, so the start tier would otherwise never appear at count 0);
	// a later tier is entered once the count crosses its boundary, walking the chain in lockstep with the
	// number. Naturally the count rises 0 → final (tiers pop as crossed); a gate tap-to-step SEEKS the
	// count forward to the next boundary, advancing exactly one tier. On the single-tier / non-escalation
	// path this is always 0 (one step) — byte-identical.
	const stepIndex = $derived.by(() => {
		if (!escalating) return 0;
		let idx = 0;
		for (let i = 1; i < steps.length; i += 1) {
			if (countUpAmount >= steps[i].boundaryAmount) idx = i;
		}
		return idx;
	});

	const current = $derived(steps[Math.min(stepIndex, steps.length - 1)]);

	// Replay the tier's INTRO whenever the count advances the chain to a new tier (a natural boundary
	// crossing or a tap-to-step seek). Guarded off during the outro so the final-tier collapse below is
	// never interrupted; inert on the single-tier path (`stepIndex` never changes there).
	let shownStepIndex = $state(0);
	$effect(() => {
		if (stepIndex === shownStepIndex) return;
		shownStepIndex = stepIndex;
		if (animationState !== 'outro') animationState = 'intro';
	});

	// Every tier's idle LOOPS: on the escalation path the count (not the idle's `complete`) advances the
	// chain, so each tier holds its looping idle until the count crosses the next boundary; on the
	// single-tier path this is the original always-looping idle (byte-identical).
	const idleLoops = $derived(animationState === 'idle');

	// ESCALATION RAMP — while the player holds to fast-forward, run the tier intro/idle spines at the
	// same multiplier as the accelerating count-up (`speedScale`), so the tiers visibly speed up in
	// lockstep instead of snapping at the end. Applied as the track `timeScale` (synced onto the live
	// `TrackEntry` by `SpineTrack`'s `propsSyncEffect`). Only while ESCALATING and the walk is still
	// running: once the count-up completes the collapse plays the OUTRO at 1×, and the single-tier /
	// non-escalating path is always 1× (= the spine default ⇒ byte-identical). `Math.max(_, 1)` never
	// slows below normal.
	const rampTimeScale = $derived(escalating && !countUpComplete ? Math.max(speedScale, 1) : 1);

	// ESCALATION ONLY — conclude the chain when the count-up finishes. Because the COUNT drives the tier
	// (`stepIndex`), a completed count-up (`countUpAmount` = final ≥ every boundary) is already on the
	// final tier's looping idle, so this simply flips it to the outro — whether the count finished
	// naturally or via a tap-to-step / slam that seeked it there. The player lands on the biggest tier's
	// art as it exits, a clean coherent end. Guarded on `escalating` + `animationState !== 'outro'` so it
	// fires once and the single-tier path never gains an outro it did not have before (byte-identical).
	$effect(() => {
		if (!escalating || !countUpComplete || animationState === 'outro') return;
		// Only outro once the count has actually reached the FINAL tier. `countUpComplete` and
		// `countUpAmount` arrive via separate `winState` fields, so a flush could observe completion a beat
		// before the count value propagates to the total — outro-ing then would play a NON-final tier's exit
		// and fire `onOutroComplete` early. The count always lands on the total (natural or slam), so this
		// effect simply re-runs and outros once `stepIndex` is final.
		if (stepIndex < steps.length - 1) return;
		animationState = 'outro';
		// SAFETY: the gate now WAITS for the outro's `complete` before concluding — but a mis-authored
		// tier with an empty outro name plays nothing, so `complete` never fires. Signal completion
		// immediately in that case so the gate can never hang (it concluded on its own timer before).
		if (!steps[steps.length - 1].animationMap.outro) onOutroComplete?.();
	});

	// ESCALATION ONLY — rewind the walk when a NEW presentation begins (the overlay persists across
	// wins, so a repeat escalating win would otherwise resume at the previous win's outro state). The
	// count resets to 0 on the fresh win (so `stepIndex` re-derives to 0 on its own); this just restores
	// the intro state + the shown-tier tracker. The gate clears `countUpComplete` on `winShow`, so its
	// true→false edge marks a fresh win. Guarded on `escalating` so the single-tier path's animationState
	// is never touched (its repeat-win intro behaviour stays exactly as today — byte-identical).
	let wasCountUpComplete = $state(false);
	$effect(() => {
		if (escalating && wasCountUpComplete && !countUpComplete) {
			shownStepIndex = 0;
			animationState = 'intro';
		}
		wasCountUpComplete = countUpComplete;
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
		timeScale={rampTimeScale}
		listener={{
			complete: () => {
				if (animationState === 'intro') {
					animationState = 'idle';
					return;
				}
				// The idle LOOPS for every tier now (the count crossing a boundary advances the chain,
				// not this `complete`), so an idle `complete` does nothing — it keeps looping until
				// either the count enters the next tier (→ new intro) or `countUpComplete` flips the
				// final tier to its outro. Only the FINAL tier's outro `complete` concludes: tell the
				// gate it may finish (escalation only; the single-tier path never reaches an outro).
				if (animationState === 'outro') onOutroComplete?.();
			},
		}}
	/>
	<SpineSlot slotName={current.slotName}>
		{@render children()}
	</SpineSlot>
</SpineProvider>
