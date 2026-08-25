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

	import { tierHasExit } from '../game/winEscalation';

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
		/**
		 * TAP-TO-STEP (escalation only): a monotonically increasing counter the GATE bumps on each tap.
		 * When it exceeds the current natural-walk tier, the walk jumps FORWARD to it (playing that tier's
		 * intro), so a tap advances exactly one tier without waiting for the idle to complete. It never
		 * pulls the walk BACK — the natural idle-complete walk still advances on its own between taps. This
		 * keeps the proven walk as the pacing clock (robust regardless of count-up speed) and layers the
		 * tap on top. Inert (0) on the single-tier / un-escalating path.
		 */
		forceStep?: number;
		/** Publishes the active tier index (escalation only) so the GATE knows which tier is showing — to
		 *  seek the count to the NEXT tier's amount on tap and to slam once on the final tier. */
		onStepIndex?: (index: number) => void;
		/** The count-up has finished — drives the FINAL tier's outro on the escalation path only. Inert
		 *  on the single-tier path (that idle loops until the overlay hides, as today). When it latches
		 *  while the chain is still mid-walk (a fast-forward / tap-to-skip of the count-up), the chain
		 *  COLLAPSES to the final tier and plays its outro cleanly, so the escalation is never truncated. */
		countUpComplete?: boolean;
		/**
		 * HOLD the final tier's idle instead of flipping it to the outro when {@link countUpComplete}
		 * latches — the player LANDED the count-up with a tap and the gate is now holding the total on
		 * screen for their dismiss press (`winState.awaitingDismiss`). Playing the exit here would take the
		 * number away in the same beat they asked to see it. Clearing it is not what resumes the end: the
		 * dismiss press satisfies the gate's wait directly and the overlay fades from this idle, so the
		 * outro stays skipped on a deliberate dismiss. Escalation only; unset ⇒ today's behaviour exactly.
		 */
		holdOutro?: boolean;
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
		forceStep = 0,
		onStepIndex,
		countUpComplete = false,
		holdOutro = false,
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
		chain && chain.length ? chain : [{ key, slotName, animationMap }],
	);

	let stepIndex = $state(0);
	let animationState = $state<AnimationState>('intro');

	const current = $derived(steps[Math.min(stepIndex, steps.length - 1)]);
	const isFinalStep = $derived(stepIndex >= steps.length - 1);

	// The FINAL tier's idle LOOPS (during the count-up), exactly as the single-tier idle always has —
	// so the single-tier path is unchanged. A NON-final tier's idle plays ONE cycle (loop off) so its
	// `complete` fires and advances the chain to the next tier's intro.
	const idleLoops = $derived(animationState === 'idle' && isFinalStep);

	// ESCALATION RAMP — while the player holds to fast-forward, run the tier intro/idle spines at the
	// same multiplier as the accelerating count-up (`speedScale`), so the tiers visibly speed up in
	// lockstep instead of snapping at the end. Applied as the track `timeScale` (synced onto the live
	// `TrackEntry` by `SpineTrack`'s `propsSyncEffect`). Only while ESCALATING and the walk is still
	// running: once the count-up completes the collapse plays the OUTRO at 1×, and the single-tier /
	// non-escalating path is always 1× (= the spine default ⇒ byte-identical). `Math.max(_, 1)` never
	// slows below normal.
	const rampTimeScale = $derived(escalating && !countUpComplete ? Math.max(speedScale, 1) : 1);

	// Whether the FINAL tier has a distinct EXIT clip — i.e. whether there is anything whose
	// `complete` could end the presentation. The rule (and why an outro authored as the idle is not
	// one) lives in `game/winEscalation.ts`, so the gate's round-blocking wait and this walk read the
	// same definition and it can be exercised without a renderer.
	const finalHasExit = $derived(tierHasExit(steps[steps.length - 1].animationMap));

	// Whether the chain has already been concluded for THIS presentation. A plain `let`, not `$state`:
	// nothing renders off it, and a read-modify-write of reactive state inside the very `$effect` that
	// writes it is the loop that shipped in `#396`.
	let chainConcluded = false;

	// ESCALATION ONLY — conclude the chain when the count-up finishes.
	//
	// On the natural walk we're already on the final tier's looping idle, so this just flips it to the
	// outro (the old behaviour). On a FAST-FORWARD / TAP-TO-SKIP the count-up can finish while the
	// chain is still mid-walk (tier 1→2→3): the count-up runs on a SEPARATE clock from the spine idle-
	// completes that advance the chain, so `countUpComplete` can latch on a NON-final tier. Rather than
	// let the chain crawl on (number done, tiers still walking) or get cut off, COLLAPSE straight to the
	// final tier and play its outro — the player lands on the biggest tier's art as it exits, a clean
	// coherent end. Guarded on `escalating` + `chainConcluded` so it fires once and the single-tier path
	// never gains an outro it did not have before (byte-identical).
	$effect(() => {
		if (!escalating || !countUpComplete || chainConcluded) return;
		// The tap that landed the count-up is holding the total on screen — stay on the idle and do NOT
		// mark the chain concluded, so the collapse below still runs untouched if the hold ever lapses.
		if (holdOutro) return;
		chainConcluded = true;
		if (!isFinalStep) stepIndex = steps.length - 1;
		if (!finalHasExit) {
			// No exit to play ⇒ nothing whose `complete` could ever arrive. Report done now and leave the
			// tier's idle on screen until the overlay hides. The guard used to cover only the EMPTY name.
			onOutroComplete?.();
			return;
		}
		animationState = 'outro';
	});

	// ESCALATION ONLY — rewind the walk when a NEW presentation begins (the overlay persists across
	// wins, so a repeat escalating win would otherwise resume at the previous win's final/outro step).
	// The gate clears `countUpComplete` on `winShow`, so its true→false edge marks a fresh win. Guarded
	// on `escalating` so the single-tier path's animationState is never touched (its repeat-win intro
	// behaviour stays exactly as today — byte-identical).
	let wasCountUpComplete = $state(false);
	$effect(() => {
		if (escalating && wasCountUpComplete && !countUpComplete) {
			stepIndex = 0;
			animationState = 'intro';
			chainConcluded = false;
		}
		wasCountUpComplete = countUpComplete;
	});

	// TAP-TO-STEP — a tap bumps `forceStep`; jump the walk FORWARD to it (never back), playing that
	// tier's intro. The natural idle-complete walk keeps advancing between taps, so this only ever
	// accelerates the walk to the tapped tier. Guarded off once the chain has concluded (the final-tier
	// collapse owns the end) and clamped to the last tier. Escalation only; inert on the single-tier path.
	$effect(() => {
		if (!escalating || chainConcluded || animationState === 'outro') return;
		const target = Math.min(forceStep, steps.length - 1);
		if (target > stepIndex) {
			stepIndex = target;
			animationState = 'intro';
		}
	});

	// Publish the active tier so the GATE can seek the count to the next tier's amount + slam on the last.
	$effect(() => onStepIndex?.(stepIndex));

	/**
	 * RE-APPLY TOKEN for the track — a value that differs on every walk transition.
	 *
	 * `<SpineTrack>` decides whether to (re)start an animation by VALUE (`shouldApplySpineAnimation`:
	 * `animationName !== track.animationName`), which is right for a declarative binding and wrong for
	 * a WALK, where the next phase can legitimately name the clip that is already playing — a tier
	 * whose outro is authored to its own idle, or two adjacent tiers sharing a clip. The track then
	 * silently never restarts: the running entry keeps going, and its `complete` arrives at the end of
	 * the OLD cycle rather than the new one's.
	 *
	 * `stepIndex * 3 + phase` is injective over (tier, phase), so consecutive states always differ and
	 * every transition re-applies — including the rewind to (0, intro) for a repeat win. Byte-identical
	 * wherever the names already differ (the token only ever ADDS a reason to apply, never removes one).
	 */
	const PHASE_ORDER: Record<AnimationState, number> = { intro: 0, idle: 1, outro: 2 };
	const replayToken = $derived(stepIndex * 3 + PHASE_ORDER[animationState]);
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
		replay={replayToken}
		timeScale={rampTimeScale}
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
				// The FINAL tier's outro finished — tell the gate it may conclude (escalation path
				// only; the single-tier path never reaches an outro, so this never fires there).
				if (animationState === 'outro') onOutroComplete?.();
			},
		}}
	/>
	<SpineSlot slotName={current.slotName}>
		{@render children()}
	</SpineSlot>
</SpineProvider>
