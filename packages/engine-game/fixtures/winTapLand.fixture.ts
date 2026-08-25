/**
 * Repro fixture for "I skip the last big win and never see the amount I won".
 *
 * Owner report on the live remake (2026-08-25): stepping the escalation tiers works, but the tap on
 * the FINAL tier dismissed the whole presentation instead of landing on the total — the number the
 * player tapped to see was gone before they could read it.
 *
 * Models the gate's tap → conclusion timeline around the extracted decision imported from source
 * (`resolveWinTap`, `game/winEscalation.ts`). The pieces it mirrors, all in `WinGate.svelte`:
 * a tap runs `stepOrSkip`; a LAND slams the count-up; the presentation concludes from `OnMount`
 * after a fixed post-count-up settle (`roundSkip.wait(300)`), and on the escalation path that
 * conclusion waits for `escalationOutroComplete` — set either by the final tier's outro finishing
 * (`WinAnimation`) or by a deliberate dismiss press (`dismissNow`), whichever comes first, and
 * bounded by a cap so the round is never blocked forever.
 *
 * Run: node --experimental-strip-types packages/engine-game/fixtures/winTapLand.fixture.ts
 */
import assert from 'node:assert/strict';

import { resolveWinTap } from '../src/game/winEscalation.ts';

/** `WinGate.svelte` — the post-count-up settle before the gate concludes. */
const SETTLE_MS = 300;
/** `WinGate.svelte` — the two runaway guards on the round-blocking wait. */
const ESCALATION_OUTRO_CAP_MS = 4_000;
const DISMISS_HOLD_CAP_MS = 10_000;
/** Measured off the engine's reference `bigwin` rig, as `winEscalationOutro.fixture.ts` records. */
const EXIT_MS = 467;

type Run = {
	/** Tier the walk ended on. */
	tierIndex: number;
	/** Whether the count-up landed on the total. */
	landed: boolean;
	/** Whether the final tier's OUTRO played (an auto conclusion) — a deliberate dismiss skips it. */
	playedOutro: boolean;
	/** Wall-clock the TOTAL is readable on screen, from the landing tap to the overlay concluding. */
	totalOnScreenMs: number;
};

/**
 * One win presentation, tapped.
 *
 * `hold` selects BEFORE and AFTER: BEFORE, the landing tap also armed the outro-skip, so the gate
 * concluded as soon as the slam settled. AFTER, the landing tap only lands and the conclusion waits
 * for the dismiss press.
 *
 * `dismissAfterMs` is when the player taps again — `null` models the player who walks away, which is
 * what the cap exists for.
 */
const run = ({
	tierCount,
	escalating,
	taps,
	hold,
	dismissAfterMs,
}: {
	tierCount: number;
	escalating: boolean;
	/** How many times the player taps during the count-up. */
	taps: number;
	hold: boolean;
	dismissAfterMs: number | null;
}): Run => {
	let tierIndex = 0;
	let landed = false;
	let awaitingDismiss = false;
	let outroSkipArmed = false;

	for (let i = 0; i < taps; i++) {
		if (landed) break; // the count-up interaction unmounts once the count lands
		const action = resolveWinTap({ escalating, tierIndex, tierCount });
		if (action.kind === 'step') {
			tierIndex = action.toTier;
			continue;
		}
		landed = true;
		if (hold && action.hold) awaitingDismiss = true;
		else outroSkipArmed = true;
	}

	// Not enough taps to reach the landing one — the count-up is still running, so there is no
	// conclusion to time yet. The stepping assertions read `tierIndex` off exactly this case.
	if (!landed) return { tierIndex, landed, playedOutro: false, totalOnScreenMs: 0 };

	// `concludePresentation`, from `OnMount`, once the slam has completed the count-up.
	let totalOnScreenMs = SETTLE_MS;
	let playedOutro = false;
	if (escalating && !outroSkipArmed) {
		const capMs = awaitingDismiss ? DISMISS_HOLD_CAP_MS : ESCALATION_OUTRO_CAP_MS;
		if (awaitingDismiss) {
			// `WinAnimation` holds the final tier's idle (`holdOutro`), so the only thing that can end
			// the wait is the dismiss press — or the cap, if it never comes.
			totalOnScreenMs += Math.min(dismissAfterMs ?? Infinity, capMs);
		} else {
			// The collapse plays the final tier's exit and the gate concludes on its `complete`.
			playedOutro = true;
			totalOnScreenMs += Math.min(EXIT_MS, capMs);
		}
	}

	return { tierIndex, landed, playedOutro, totalOnScreenMs };
};

const FIVE_TIERS = { tierCount: 5, escalating: true } as const;

// ---------------------------------------------------------------------------------------------
// STEPPING is untouched: every tap before the final tier still advances exactly one tier.
// ---------------------------------------------------------------------------------------------
for (const hold of [false, true]) {
	for (let taps = 1; taps <= 4; taps++) {
		assert.equal(
			run({ ...FIVE_TIERS, taps, hold, dismissAfterMs: null }).tierIndex,
			taps,
			`expected tap ${taps} of a 5-tier chain to step to tier ${taps} (hold=${hold})`,
		);
	}
}
assert.deepEqual(
	resolveWinTap({ escalating: true, tierIndex: 0, tierCount: 5 }),
	{ kind: 'step', toTier: 1 },
	'expected a mid-chain tap to step',
);

// ---------------------------------------------------------------------------------------------
// THE BUG. The 5th tap — on the final tier — lands the total. BEFORE, the overlay concluded on the
// settle alone: 300ms of the number the player asked to see. AFTER, it holds until they tap again.
// ---------------------------------------------------------------------------------------------
const before = run({ ...FIVE_TIERS, taps: 5, hold: false, dismissAfterMs: 2_000 });
const after = run({ ...FIVE_TIERS, taps: 5, hold: true, dismissAfterMs: 2_000 });

assert.equal(before.tierIndex, 4, 'expected the walk to end on the final tier either way');
assert.equal(after.tierIndex, 4);
assert.ok(
	before.landed && after.landed,
	'expected the landing tap to slam the count-up either way',
);

assert.equal(
	before.totalOnScreenMs,
	SETTLE_MS,
	'expected the OLD landing tap to conclude on the settle alone — the reported bug',
);
assert.equal(
	after.totalOnScreenMs,
	SETTLE_MS + 2_000,
	'expected the landing tap to hold the total until the player dismisses it',
);
assert.ok(
	after.totalOnScreenMs > before.totalOnScreenMs,
	'expected the total to be readable for longer than it takes to blink',
);

// A deliberate dismiss still hides INSTANTLY, outro skipped — `#295`'s fix, unchanged. The hold adds
// a tap before that dismiss; it does not put the outro back in front of one.
assert.equal(after.playedOutro, false, 'expected a deliberate dismiss to skip the tier outro');
assert.equal(before.playedOutro, false);

// ---------------------------------------------------------------------------------------------
// THE ABANDONED HOLD. A player who lands the total and then puts the phone down must not block the
// round forever: the wait is capped, and by the HUMAN cap (not the outro's, which sizes an
// animation that is deliberately not playing while the hold is up).
// ---------------------------------------------------------------------------------------------
const abandoned = run({ ...FIVE_TIERS, taps: 5, hold: true, dismissAfterMs: null });
assert.equal(
	abandoned.totalOnScreenMs,
	SETTLE_MS + DISMISS_HOLD_CAP_MS,
	'expected an abandoned hold to conclude on the dismiss cap',
);
assert.ok(
	DISMISS_HOLD_CAP_MS > ESCALATION_OUTRO_CAP_MS,
	'expected the human cap to outlast the animation cap it replaces',
);

// ---------------------------------------------------------------------------------------------
// PARITY. An UN-escalating win has no tiers and nothing to look at once the number lands: it must
// land and get out of the way exactly as before, hold or no hold.
// ---------------------------------------------------------------------------------------------
const plainBefore = run({
	tierCount: 0,
	escalating: false,
	taps: 1,
	hold: false,
	dismissAfterMs: null,
});
const plainAfter = run({
	tierCount: 0,
	escalating: false,
	taps: 1,
	hold: true,
	dismissAfterMs: null,
});
assert.deepEqual(plainAfter, plainBefore, 'expected an un-escalating win to be untouched');
assert.equal(plainAfter.totalOnScreenMs, SETTLE_MS);
assert.deepEqual(
	resolveWinTap({ escalating: false, tierIndex: 0, tierCount: 0 }),
	{ kind: 'land', hold: false },
	'expected an un-escalating tap to land without holding',
);

// A single-tier chain IS the final tier from the first tap — it holds, like any other escalating win.
assert.deepEqual(
	resolveWinTap({ escalating: true, tierIndex: 0, tierCount: 1 }),
	{ kind: 'land', hold: true },
	'expected the only tier of a one-tier chain to land-and-hold',
);

console.log(
	'\nOK — the final-tier tap lands the total and holds it for a dismiss tap; stepping, the instant dismiss and un-escalating wins are unchanged.',
);
