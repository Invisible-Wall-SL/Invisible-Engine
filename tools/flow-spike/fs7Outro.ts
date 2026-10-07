/**
 * Invisible Flow — FS-7 free-spin OUTRO authoring harness (design doc §14, outro round-gate).
 *
 *   pnpm --filter flow-spike run fs7outro
 *
 * Proves, HEADLESSLY against the REAL engine-layout signal gates, the seams an authored free-spin
 * outro screen is built from — the engine keeps only the headless count-up driver, and the screen
 * owns the art, the dim and the tap:
 *
 *  A. The win-level fired signals (`freeSpinOutroBigWin` / `freeSpinOutroSmallWin`) drive the pure
 *     `isNodeRevealed` gate exactly as the per-instance bus records them — so authored big/small art
 *     gated by `hiddenUntilSignal` reveals on the matching tier and stays hidden on the other.
 *
 *  B. The count-up-complete fired signal (`freeSpinOutroCountUpComplete`, broadcast by the driver
 *     when `startCountUp()` resolves) arms a `tapArmAfterSignal` tap + reveals a `hiddenUntilSignal`
 *     prompt ONLY after the count-up finishes — what keeps a tap during the count from dismissing
 *     the outro.
 *
 *  C. The `countUpComplete` latch makes that tap-arm ORDER-INDEPENDENT (the stuck-outro fix).
 */

import { isNodeRevealed, isTapArmed } from '../../packages/engine-layout/src/lib/signalGates';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

console.log('Invisible Flow — FS-7 free-spin OUTRO authoring harness\n');

// ---------------------------------------------------------------------------
// A. win-level fired signals gate authored big/small art via isNodeRevealed.
// ---------------------------------------------------------------------------
console.log('\nA. freeSpinOutroBigWin / freeSpinOutroSmallWin gate reveal:');
// Unfired: both hidden (an outro before the count-up begins).
assert('big-win art hidden before any fire', isNodeRevealed('freeSpinOutroBigWin', {}) === false);
assert(
	'small-win art hidden before any fire',
	isNodeRevealed('freeSpinOutroSmallWin', {}) === false,
);
// A BIG-tier count-up fires only `freeSpinOutroBigWin` (Game.svelte's registered signal filter):
// the per-instance bus records it; the driver logic never fires the small one.
const bigBus = { freeSpinOutroBigWin: 1 };
assert('big fired ⇒ big-win art revealed', isNodeRevealed('freeSpinOutroBigWin', bigBus) === true);
assert(
	'big fired ⇒ small-win art STILL hidden',
	isNodeRevealed('freeSpinOutroSmallWin', bigBus) === false,
);
// A SMALL/non-big tier fires only `freeSpinOutroSmallWin`.
const smallBus = { freeSpinOutroSmallWin: 1 };
assert(
	'small fired ⇒ small-win art revealed',
	isNodeRevealed('freeSpinOutroSmallWin', smallBus) === true,
);
assert(
	'small fired ⇒ big-win art STILL hidden',
	isNodeRevealed('freeSpinOutroBigWin', smallBus) === false,
);
// Ungated node (no hiddenUntilSignal) is always revealed (parity — the count text / rig).
assert('ungated node always revealed', isNodeRevealed(undefined, {}) === true);

// ---------------------------------------------------------------------------
// B. freeSpinOutroCountUpComplete arms the tap / reveals the prompt only AFTER the count-up.
// ---------------------------------------------------------------------------
console.log('\nB. freeSpinOutroCountUpComplete gates tap-arm + prompt reveal:');
const COMPLETE = 'freeSpinOutroCountUpComplete';
// Before the count-up finishes the bus has no fire ⇒ tap inert, prompt hidden.
assert('tap NOT armed before count-up completes', isTapArmed(COMPLETE, {}) === false);
assert('prompt hidden before count-up completes', isNodeRevealed(COMPLETE, {}) === false);
// The driver broadcasts the event on `startCountUp()` resolve ⇒ the per-instance bus records it.
const doneBus = { [COMPLETE]: 1 };
assert('tap armed after count-up completes', isTapArmed(COMPLETE, doneBus) === true);
assert('prompt revealed after count-up completes', isNodeRevealed(COMPLETE, doneBus) === true);
// An un-gated tap (no `tapArmAfterSignal`) is armed on mount (parity — today's behaviour).
assert('un-gated tap armed on mount (parity)', isTapArmed(undefined, {}) === true);

// ---------------------------------------------------------------------------
// C. The `countUpComplete` latch makes tap-arm ORDER-INDEPENDENT (the stuck-outro fix).
// A ZERO / instant count-up (level 1 `'zero'`, amount:0, presentDuration:0) finishes in the same
// tick the authored screen mounts, so the driver's `freeSpinOutroCountUpComplete` broadcast can fire
// BEFORE the screen subscribes. The emitter has NO replay (a fire with no subscriber is lost), so
// without the fix the per-instance bus never records it and `isTapArmed` stays false ⇒ stuck outro.
// The fix: the driver latches `freeSpinOutroState.countUpComplete=true` before broadcasting, and the
// registered signal source seeds `if (latch) run()` on subscribe — so a LATE subscriber still arms.
// This models that exact mechanism (record-on-fire only while subscribed + seed-on-subscribe) and
// asserts it against the REAL `isTapArmed`.
// ---------------------------------------------------------------------------
console.log('\nC. countUpComplete latch seeds a LATE subscriber (order-independent tap-arm):');
const armModel = (latch: { countUpComplete: boolean }, seedOnSubscribe: boolean) => {
	const bus: Record<string, number> = {};
	let subscribed = false;
	const record = () => (bus[COMPLETE] = (bus[COMPLETE] ?? 0) + 1);
	return {
		broadcast: () => subscribed && record(), // no replay: a fire with no live subscriber is lost
		subscribe: () => {
			subscribed = true;
			if (seedOnSubscribe && latch.countUpComplete) record(); // the fix's seed
		},
		armed: () => isTapArmed(COMPLETE, bus),
	};
};
// Zero/instant win — completion broadcasts BEFORE the screen subscribes.
{
	const latch = { countUpComplete: false };
	const a = armModel(latch, false); // WITHOUT the seed
	latch.countUpComplete = true;
	a.broadcast();
	a.subscribe();
	assert(
		'no seed + completion-before-subscribe ⇒ tap NEVER arms (reproduces the stuck outro)',
		a.armed() === false,
	);
}
{
	const latch = { countUpComplete: false };
	const a = armModel(latch, true); // WITH the seed (the fix)
	latch.countUpComplete = true;
	a.broadcast();
	a.subscribe();
	assert('seed + completion-before-subscribe ⇒ tap ARMS (the fix)', a.armed() === true);
}
// Real win — the screen subscribes BEFORE the long count-up completes ⇒ armed either way.
{
	const latch = { countUpComplete: false };
	const a = armModel(latch, true);
	a.subscribe();
	latch.countUpComplete = true;
	a.broadcast();
	assert('real win (subscribe-before-broadcast) arms', a.armed() === true);
}

console.log(failed ? '\nFS-7 outro harness: FAIL' : '\nFS-7 outro harness: PASS');
if (failed) process.exit(1);
