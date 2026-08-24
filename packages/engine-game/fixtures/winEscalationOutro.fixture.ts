/**
 * Repro fixture for "the big win steps its tiers but will not dismiss".
 *
 * Models the real chain around the two extracted decisions, both imported from source:
 * `tierHasExit` (`game/winEscalation.ts`) and `shouldApplySpineAnimation`
 * (`pixi-svelte/spineTrackReplay.ts`). `<WinAnimation>` walks a tier chain intro→idle→…→outro and
 * hands `<SpineTrack>` an animation name per phase; the gate's round-blocking
 * `waitForEscalationOutro` resolves only when the walk reports the final tier's outro complete.
 *
 * The authoring under test is the Book of Borut remake's, read off its live scene doc: three
 * escalating tiers on one rig whose "outro" for every tier is that tier's own IDLE clip
 * (`bigOutro: Tier1_Idle`, `superwinOutro: Tier2_Idle`, `megaOutro: Tier3_Idle`).
 *
 * Run: node --experimental-strip-types packages/engine-game/fixtures/winEscalationOutro.fixture.ts
 */
import assert from 'node:assert/strict';

import { tierHasExit, type TierAnimationMap } from '../src/game/winEscalation.ts';
import {
	shouldApplySpineAnimation,
	type SpineTrackSnapshot,
} from '../../pixi-svelte/src/lib/spineTrackReplay.ts';

type Tier = { key: string; animationMap: TierAnimationMap };
type Phase = 'intro' | 'idle' | 'outro';

const PHASE_ORDER: Record<Phase, number> = { intro: 0, idle: 1, outro: 2 };

/** Measured off the engine's reference `bigwin` rig — an exit and an idle are not the same class. */
const EXIT_MS = 467;
const IDLE_MS = 12_000;

/**
 * The walk, as `<WinAnimation>` runs it, over a `<SpineTrack>` that applies by the real decision.
 *
 * `withReplay` / `withIdleAsExitGuard` select the BEFORE and AFTER of this change:
 *  - `withReplay` — pass the (tier, phase) re-apply token, so a phase naming the clip that is
 *    already playing still restarts the track.
 *  - `withIdleAsExitGuard` — treat "outro is this tier's idle" as NO exit (the old code only
 *    short-circuited an EMPTY name).
 */
const runChain = ({
	tiers,
	withReplay,
	withIdleAsExitGuard,
}: {
	tiers: Tier[];
	withReplay: boolean;
	withIdleAsExitGuard: boolean;
}) => {
	let stepIndex = 0;
	let phase: Phase = 'intro';

	let track: SpineTrackSnapshot = null;
	let appliedReplay: number | undefined;
	const setAnimationCalls: string[] = [];
	/** Wall-clock the ROUND spends blocked waiting on the final tier's `complete`. */
	let blockedMs = 0;
	let outroComplete = false;

	const finalMap = tiers[tiers.length - 1].animationMap;
	const hasExit = withIdleAsExitGuard ? tierHasExit(finalMap) : !!finalMap.outro;

	// `<SpineTrack>`'s $effect.
	const syncTrack = () => {
		const animationName = tiers[stepIndex].animationMap[phase];
		const replay = withReplay ? stepIndex * 3 + PHASE_ORDER[phase] : undefined;
		if (
			shouldApplySpineAnimation({
				trackIndex: 0,
				animationName,
				then: undefined,
				replay,
				appliedReplay,
				track,
			})
		) {
			appliedReplay = replay;
			setAnimationCalls.push(animationName);
			track = { trackIndex: 0, animationName };
		}
	};

	syncTrack(); // mount: tier 0's intro
	// Walk the tiers the way the idle-completes do, up to the final one's looping idle.
	while (stepIndex < tiers.length - 1) {
		phase = 'idle';
		syncTrack();
		stepIndex += 1;
		phase = 'intro';
		syncTrack();
	}
	phase = 'idle';
	syncTrack();

	// The count-up lands. The chain collapses to the final tier and concludes.
	if (!hasExit) {
		// Nothing to play and nothing to wait for — report done and leave the idle on screen.
		outroComplete = true;
	} else {
		phase = 'outro';
		syncTrack();
		// The gate now waits for `complete`. It arrives at the end of whatever clip is ACTUALLY
		// running on the track — which is the point of the replay token: without it the outro never
		// restarted, so the round waited out the running idle instead of the exit.
		const playing = track?.animationName;
		blockedMs = playing === finalMap.outro && playing !== finalMap.idle ? EXIT_MS : IDLE_MS;
		outroComplete = true;
	}

	return { setAnimationCalls, blockedMs, outroComplete };
};

/** The remake's authoring: three tiers on one rig, every "outro" pointed at that tier's idle. */
const remakeTiers: Tier[] = [
	{
		key: 'R_Cinematic2',
		animationMap: { intro: 'Tier1_Intro', idle: 'Tier1_Idle', outro: 'Tier1_Idle' },
	},
	{
		key: 'R_Cinematic2',
		animationMap: { intro: 'Tier2_Intro', idle: 'Tier2_Idle', outro: 'Tier2_Idle' },
	},
	{
		key: 'R_Cinematic2',
		animationMap: { intro: 'Tier3Intro', idle: 'Tier3_Idle', outro: 'Tier3_Idle' },
	},
];

/** The engine's reference `bigwin` authoring: a real, separate exit clip per tier. */
const referenceTiers: Tier[] = [
	{
		key: 'bigwin',
		animationMap: { intro: 'big_win_intro', idle: 'big_win_idle', outro: 'big_win_exit' },
	},
	{
		key: 'bigwin',
		animationMap: { intro: 'super_win_intro', idle: 'super_win_idle', outro: 'super_win_exit' },
	},
	{
		key: 'bigwin',
		animationMap: { intro: 'mega_win_intro', idle: 'mega_win_idle', outro: 'mega_win_exit' },
	},
];

const before = (tiers: Tier[]) =>
	runChain({ tiers, withReplay: false, withIdleAsExitGuard: false });
const after = (tiers: Tier[]) => runChain({ tiers, withReplay: true, withIdleAsExitGuard: true });

console.log('--- BEFORE ---');
const beforeRemake = before(remakeTiers);
const beforeReference = before(referenceTiers);
console.log('remake   ', beforeRemake);
console.log('reference', beforeReference);

console.log('--- AFTER ---');
const afterRemake = after(remakeTiers);
const afterReference = after(referenceTiers);
console.log('remake   ', afterRemake);
console.log('reference', afterReference);

// THE BUG. The final tier's outro names the clip already playing, so the track never restarted and
// the round sat blocked for a full 12-second idle cycle after the count-up had landed. That is the
// "steps the tiers but will not dismiss" the owner reported.
assert.equal(
	beforeRemake.setAnimationCalls.at(-1),
	'Tier3_Idle',
	'expected the OLD walk to end on the idle',
);
assert.equal(
	beforeRemake.setAnimationCalls.filter((a) => a === 'Tier3_Idle').length,
	1,
	'expected the OLD track to never re-apply the same-named outro',
);
assert.equal(
	beforeRemake.blockedMs,
	IDLE_MS,
	'expected the OLD round to wait out a full idle cycle',
);

// THE FIX. No distinct exit ⇒ nothing to wait for ⇒ the gate concludes at once, and the tier's idle
// simply stays on screen until the overlay hides.
assert.equal(
	afterRemake.blockedMs,
	0,
	'expected the round not to block on an outro that is an idle',
);
assert.equal(afterRemake.outroComplete, true, 'expected the chain to report complete immediately');
assert.deepEqual(
	afterRemake.setAnimationCalls,
	['Tier1_Intro', 'Tier1_Idle', 'Tier2_Intro', 'Tier2_Idle', 'Tier3Intro', 'Tier3_Idle'],
	'expected the walk itself to be unchanged — every tier still plays, in order',
);

// PARITY. A rig with real exit clips is untouched: it still plays its exit, and the round still
// waits for that exit (467ms) — not for an idle.
assert.deepEqual(
	afterReference.setAnimationCalls,
	beforeReference.setAnimationCalls,
	'expected a rig with real exits to play exactly the same animations as before',
);
assert.equal(afterReference.setAnimationCalls.at(-1), 'mega_win_exit');
assert.equal(afterReference.blockedMs, EXIT_MS, 'expected the exit, not an idle, to pace the end');

// The replay token also covers the general collision the walk can hit: two ADJACENT tiers sharing a
// clip. Without it the second tier's intro is a silent no-op and that tier never visibly plays.
const sharedClipTiers: Tier[] = [
	{ key: 'r', animationMap: { intro: 'flash', idle: 'hold', outro: 'exit' } },
	{ key: 'r', animationMap: { intro: 'hold', idle: 'hold', outro: 'exit' } },
];
assert.equal(
	before(sharedClipTiers).setAnimationCalls.filter((a) => a === 'hold').length,
	1,
	'expected the OLD track to skip a tier whose intro names the clip already playing',
);
assert.equal(
	after(sharedClipTiers).setAnimationCalls.filter((a) => a === 'hold').length,
	3,
	'expected every phase to re-apply once the token distinguishes them',
);

console.log(
	'\nOK — an outro authored as an idle no longer blocks the round; real exits still pace the end.',
);
