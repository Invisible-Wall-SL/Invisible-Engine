/**
 * Repro fixture for "the spine plays the FIRST free-spin feature and never again".
 *
 * Models the real chain around the extracted decision (`shouldApplySpineAnimation`, imported from
 * source): a `<ComponentInstance>` signal cue writes `{ animation, loop, fire }` into the
 * signal-anim map, `<LayoutNodeView>` forwards it to `<SpineTrack>`, and the track applies the
 * animation only when the decision says so. Two free-spin features are driven through it and the
 * number of actual `setAnimation` calls is asserted.
 *
 * Run: node --experimental-strip-types packages/pixi-svelte/fixtures/spineTrackReplay.fixture.ts
 */
import assert from 'node:assert/strict';

import { shouldApplySpineAnimation, type SpineTrackSnapshot } from '../src/lib/spineTrackReplay.ts';

type Cue = { signal: string; animation: string; loop?: boolean };

/** A spine node with a "Plays on signal" cue, as an author places it in the Scene Editor. */
const createSpine = ({
	cues,
	defaultAnimation,
	withReplay,
}: {
	cues: Cue[];
	defaultAnimation?: string;
	withReplay: boolean;
}) => {
	// `<ComponentInstance>`: the reactive signal-anim map + the monotonic fire token.
	let signalAnim: { animation: string; loop?: boolean; fire: number } | undefined;
	let signalFire = 0;

	// The live Spine track and what actually reached the runtime.
	let track: SpineTrackSnapshot = null;
	let appliedReplay: number | undefined;
	const setAnimationCalls: string[] = [];

	// `<SpineTrack>`'s $effect, re-run whenever its inputs change.
	const syncTrack = () => {
		const anim = signalAnim?.animation ?? defaultAnimation ?? null;
		if (!anim) return;
		const handsOffToIdle = !!(
			signalAnim &&
			defaultAnimation &&
			defaultAnimation !== signalAnim.animation
		);
		const replay = withReplay ? signalAnim?.fire : undefined;
		if (
			shouldApplySpineAnimation({
				trackIndex: 0,
				animationName: anim,
				then: handsOffToIdle ? defaultAnimation : undefined,
				replay,
				appliedReplay,
				track,
			})
		) {
			appliedReplay = replay;
			setAnimationCalls.push(anim);
			track = { trackIndex: 0, animationName: anim };
		}
	};

	// Mount: the resting `defaultAnimation`, if the node has one.
	syncTrack();

	return {
		/** The game broadcast a signal — `<ComponentInstance>` writes the cue and the track syncs. */
		fire: (signal: string) => {
			const cue = cues.find((c) => c.signal === signal);
			if (!cue) return;
			signalFire += 1;
			signalAnim = { animation: cue.animation, loop: cue.loop, fire: signalFire };
			syncTrack();
		},
		/** The queued `then` animation took over after the one-shot completed. */
		advanceToThen: () => {
			if (defaultAnimation) track = { trackIndex: 0, animationName: defaultAnimation };
		},
		setAnimationCalls,
	};
};

/** Two free-spin features in ONE session, on a cue-only spine (no resting animation). */
const twoFeatures = (withReplay: boolean) => {
	const spine = createSpine({
		cues: [{ signal: 'freeSpinStart', animation: 'intro', loop: false }],
		withReplay,
	});
	spine.fire('freeSpinStart'); // feature 1 — runs to its end and parks on its last frame
	spine.fire('freeSpinEnd'); // not cued — nothing happens
	spine.fire('freeSpinStart'); // feature 2, same session
	return spine.setAnimationCalls;
};

/** The same, on a spine that rests on a looping `idle` (the one-shot → idle hand-off). */
const twoFeaturesWithIdle = (withReplay: boolean) => {
	const spine = createSpine({
		cues: [{ signal: 'specialBookReveal', animation: 'reveal', loop: false }],
		defaultAnimation: 'idle',
		withReplay,
	});
	spine.fire('specialBookReveal'); // feature 1
	spine.advanceToThen(); // intro finished → the queued idle loop took over
	spine.fire('specialBookReveal'); // feature 2, same session
	return spine.setAnimationCalls;
};

console.log('--- BEFORE (no replay token) ---');
const beforeCueOnly = twoFeatures(false);
const beforeWithIdle = twoFeaturesWithIdle(false);
console.log('cue-only spine, setAnimation calls:', beforeCueOnly);
console.log('idle-resting spine, setAnimation calls:', beforeWithIdle);

console.log('--- AFTER (replay token) ---');
const afterCueOnly = twoFeatures(true);
const afterWithIdle = twoFeaturesWithIdle(true);
console.log('cue-only spine, setAnimation calls:', afterCueOnly);
console.log('idle-resting spine, setAnimation calls:', afterWithIdle);

// The reported bug: the cue plays on the first feature and is a no-op on every one after, because
// the second fire is value-identical to the first. This is the owner's spine — it works once.
assert.deepEqual(beforeCueOnly, ['intro'], 'expected the OLD code to play the cue exactly once');
// A SECOND, worse pre-existing bug the same token fixes: when the node also has a resting
// `defaultAnimation`, the track is already sitting on it, and `then === track.animationName`
// collapses the guard — so the cue never plays AT ALL, not even the first time.
assert.deepEqual(
	beforeWithIdle,
	['idle'],
	'expected the OLD idle-resting spine to never play its cue',
);

// The fix: every fire plays.
assert.deepEqual(afterCueOnly, ['intro', 'intro'], 'expected the cue to play once per feature');
assert.deepEqual(
	afterWithIdle,
	['idle', 'reveal', 'reveal'],
	'expected the idle-resting spine to keep playing once per feature',
);

// Parity: a spine with no cue at all is untouched by the token.
const declarative = createSpine({ cues: [], defaultAnimation: 'idle', withReplay: true });
declarative.fire('freeSpinStart');
assert.deepEqual(declarative.setAnimationCalls, ['idle'], 'expected an uncued spine to be parity');

console.log('\nOK — the cue replays once per free-spin feature; uncued spines are unchanged.');
