/**
 * Repro fixture for "the book-reveal rig plays the FIRST free-spin feature and freezes on the
 * second" — `apps/lines/src/components/FreeSpinIntroSymbolReveal.svelte`.
 *
 * Unlike the signal-cue path (see `spineTrackReplay.fixture.ts`), this component drives
 * `<SpineTrack animationName>` DIRECTLY with a plain prop and NO replay token, so the a3d16cb
 * fix does not touch it. The failure is a RACE, not a stale value:
 *
 *   The intro plays once, then the component swaps `animationName` to a LOOPING idle. Spine fires
 *   `complete` at the END OF EVERY idle loop. The reveal's `complete` listener runs the intro→idle
 *   hand-off whenever `phase === 'intro'`. On a retrigger, `play()` flips `phase` to 'intro'
 *   SYNCHRONOUSLY, but the SpineTrack `$effect` that actually applies the intro animation runs a
 *   tick later. A stray idle-loop `complete` landing in that window (rig still on the looping idle)
 *   sees `phase === 'intro'`, runs the hand-off against an intro that never played — settling the
 *   reveal EARLY and pinning `animationName` back to idle before the effect can apply intro. The
 *   value guard then sees idle===idle and never re-applies. Net: intro never plays on feature 2,
 *   the rig sits frozen on idle, and the round still unblocks (early settle).
 *
 * This models the persist scenario (the rig is NOT torn down between features — the live flow-v2
 * doc doesn't deliver `specialBookHide` to the mounted component, so `phase` stays 'idle', `show`
 * stays true, and FadeContainer never fades the SpineProvider out). See the fixture output.
 *
 * The fix: the `complete` listener reacts ONLY to the INTRO animation completing
 * (`entry.animation.name === introAnimation`), so a stray idle-loop completion can't abort a fresh
 * intro. The real SpineTrack value guard (`shouldApplySpineAnimation`) is reused verbatim so the
 * "would the effect actually re-apply?" question is answered by the shipping code, not a mock.
 *
 * Run: node --experimental-strip-types packages/pixi-svelte/fixtures/introRevealRetrigger.fixture.ts
 */
import assert from 'node:assert/strict';

import { shouldApplySpineAnimation, type SpineTrackSnapshot } from '../src/lib/spineTrackReplay.ts';

const INTRO = 'intro';
const IDLE = 'idle';

/** A persistent Spine rig + its `<SpineTrack>` — the applied animation, the `complete` listener,
 *  and the deferred value-guarded apply that the component's `$effect` performs. */
const createRig = (listener: (entry: { animation: { name: string } }) => void) => {
	let applied: { name: string; loop: boolean } | null = null;
	const setAnimationCalls: string[] = [];

	const snapshot = (): SpineTrackSnapshot =>
		applied ? { trackIndex: 0, animationName: applied.name } : null;

	return {
		/** The deferred `<SpineTrack>` $effect: apply `animationName` iff the real value guard says
		 *  so (no replay token — this component doesn't pass one). */
		applyEffect: (animationName: string, loop: boolean) => {
			if (
				shouldApplySpineAnimation({
					trackIndex: 0,
					animationName,
					then: undefined,
					replay: undefined,
					appliedReplay: undefined,
					track: snapshot(),
				})
			) {
				applied = { name: animationName, loop };
				setAnimationCalls.push(animationName);
			}
		},
		/** Spine fires `complete` at the end of the current animation (every cycle when looping). */
		fireComplete: () => {
			if (applied) listener({ animation: { name: applied.name } });
		},
		appliedName: () => applied?.name ?? null,
		setAnimationCalls,
	};
};

/** The FreeSpinIntroSymbolReveal reveal logic, in both the current and fixed shapes. */
const createReveal = (fixed: boolean) => {
	let phase: 'hidden' | 'intro' | 'idle' = 'hidden';
	let animationName = INTRO;
	let revealResolve: (() => void) | null = null;
	const log: string[] = [];
	// Fired synchronously the instant a reveal settles — the fixture uses it to snapshot whether the
	// intro had actually reached the rig by then (an EARLY settle rides an intro that never played).
	let onSettle: (() => void) | null = null;

	const settleReveal = () => {
		const resolve = revealResolve;
		revealResolve = null;
		if (resolve) resolve();
	};

	const completeListener = (entry: { animation: { name: string } }) => {
		// CURRENT: react to ANY completion while phase==='intro' (the bug). FIXED: only when the
		// INTRO animation is the one that completed — a stray idle-loop complete is ignored.
		const isIntroCompletion = fixed ? entry.animation.name === INTRO : true;
		if (phase === 'intro' && isIntroCompletion) {
			phase = 'idle';
			animationName = IDLE;
			settleReveal();
			log.push('handoff→idle');
		}
	};

	return {
		completeListener,
		/** `play(target)` — a new reveal. Returns a promise that settles when the intro is done. */
		play: () => {
			settleReveal();
			return new Promise<void>((resolve) => {
				revealResolve = () => {
					resolve();
					log.push('settle');
					onSettle?.();
				};
				animationName = INTRO;
				phase = 'intro';
			});
		},
		/** `hide()` — dismiss (specialBookHide). Left as the real component has it. */
		hide: () => {
			settleReveal();
			phase = 'hidden';
		},
		desired: () => ({ animationName, loop: animationName === IDLE }),
		phase: () => phase,
		setOnSettle: (fn: () => void) => (onSettle = fn),
		log,
	};
};

/**
 * One free-spin feature, plus the RACE on the retrigger: `withStrayIdleComplete` fires a lingering
 * idle-loop `complete` in the window after `play()` flips phase but before the effect applies
 * intro. `settleOrder` records, for the settle event, whether the intro had actually been applied.
 */
const runTwoFeatures = (fixed: boolean) => {
	const reveal = createReveal(fixed);
	const rig = createRig(reveal.completeListener);
	const introAppliesAtSettle: boolean[] = [];
	// At the instant each reveal settles, snapshot whether a NEW intro (this feature's) had reached
	// the rig. An EARLY settle (the bug) fires with no fresh intro applied.
	let introsAtFeatureStart = 0;
	reveal.setOnSettle(() =>
		introAppliesAtSettle.push(
			rig.setAnimationCalls.filter((n) => n === INTRO).length > introsAtFeatureStart,
		),
	);

	const feature = (withStrayIdleComplete: boolean) => {
		introsAtFeatureStart = rig.setAnimationCalls.filter((n) => n === INTRO).length;
		void reveal.play(); // sync: phase='intro', animationName='intro'
		if (withStrayIdleComplete) rig.fireComplete(); // STRAY idle-loop complete in the race window
		const applied = reveal.desired();
		rig.applyEffect(applied.animationName, applied.loop); // the deferred SpineTrack $effect
		rig.fireComplete(); // whatever is applied completes (intro → hand-off, or idle no-op)
		const after = reveal.desired();
		rig.applyEffect(after.animationName, after.loop); // effect re-runs after the hand-off
		// The rig now sits on a looping idle firing completes; nothing consumes them until retrigger.
		rig.fireComplete();
		rig.fireComplete();
	};

	feature(false); // feature 1 — no stray complete (fresh rig)
	feature(true); // feature 2 — the retrigger race

	return {
		calls: rig.setAnimationCalls,
		appliedName: rig.appliedName(),
		introAppliesAtSettle,
		log: reveal.log,
	};
};

console.log('--- BEFORE (complete reacts to any completion) ---');
const before = runTwoFeatures(false);
console.log('setAnimation calls:', before.calls);
console.log('rig ends on:', before.appliedName);

console.log('--- AFTER (complete reacts only to the intro animation) ---');
const after = runTwoFeatures(true);
console.log('setAnimation calls:', after.calls);
console.log('rig ends on:', after.appliedName);

const introCount = (r: { calls: string[] }) => r.calls.filter((n) => n === INTRO).length;

// The bug: the intro plays on feature 1 only; the feature-2 retrigger race aborts it, and the rig
// is left frozen on idle.
assert.equal(
	introCount(before),
	1,
	'expected the OLD code to play the intro only once (feature 1)',
);
assert.equal(before.appliedName, IDLE, 'expected the OLD rig to end frozen on idle');

// The OLD code settled feature 2 EARLY — before any NEW intro was applied that feature (the stray
// idle complete ran the hand-off and settled against nothing). f1 settled honestly, f2 did not.
assert.deepEqual(
	before.introAppliesAtSettle,
	[true, false],
	'expected the OLD code to settle feature 2 EARLY (before its intro played)',
);

// The fix: the intro plays once per feature, and the rig ends on idle each time (proper hand-off).
assert.equal(introCount(after), 2, 'expected the intro to play once per free-spin feature');
assert.equal(after.appliedName, IDLE, 'expected the rig to settle on idle after each feature');

// Settle-once per feature, and never EARLY: every settle happened only after THIS feature's intro
// had reached the rig, so the round unblocks on a real reveal — not before one, and not hanging.
assert.deepEqual(
	after.introAppliesAtSettle,
	[true, true],
	'expected each feature to settle only AFTER its intro was applied (no early settle)',
);
assert.equal(
	after.log.filter((l) => l === 'settle').length,
	2,
	'expected exactly one settle per feature (round never hangs, never double-settles)',
);

console.log('\nOK — the intro plays once per feature; the rig hands off to idle; no early settle.');
