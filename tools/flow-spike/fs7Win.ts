/**
 * Invisible Flow — WIN OVERLAY authoring harness (design doc §14, the win-overlay twin of the FS-7
 * outro round-gate). OWNERSHIP-based + NAME-AGNOSTIC.
 *
 *   pnpm --filter flow-spike run fs7win
 *
 * Proves, HEADLESSLY against the REAL apps/lines modules, the seam that lets an author rebuild the WIN
 * overlay entirely from primitives (own dim / Text Box count / spine / tap), under a container of ANY
 * name, while the engine keeps only the load-bearing count-up:
 *
 *  A. `resolveWinMount` — the NON-NEGOTIABLE invariant: under a v2 flow there is ALWAYS EXACTLY ONE
 *     `winUpdate` subscriber across the engine gate PLUS a coded `Win`/`WinGate` in `basegameOverlays`,
 *     for EVERY combination of (flowV2DrivesScreens, flowOwnsSetWin, basegameOverlaysHasCodedWinGate).
 *     Two would hang the round; zero would no-op the count-up. A non-flow game mounts NOTHING (the coded
 *     composer owns it — parity). The TRIGGER for the headless `'driver'` is `ownsEvent('setWin')`, NOT a
 *     scene id — so the author names the container anything. A coded gate in `basegameOverlays` always
 *     wins (stand down), matching `main`'s `flowV2DrivesScreens && !basegameOverlaysHasCodedWinGate`.
 *
 *  B. The count-up-complete fired signal (`winCountUpComplete`, broadcast by `WinGate` when
 *     `startCountUp()` resolves) arms a `tapArmAfterSignal` tap + reveals a `hiddenUntilSignal` prompt
 *     ONLY after the count-up finishes — the seam that gates the tap on the count.
 *
 *  C. The `winState.countUpComplete` latch makes tap-arm ORDER-INDEPENDENT (a ZERO / instant count-up
 *     finishes in the same tick the container mounts, so the broadcast can fire before the subscribe).
 */

import { isNodeRevealed, isTapArmed } from '../../packages/engine-layout/src/lib/signalGates';
import { resolveWinMount } from '../../packages/engine-game/src/game/winOwnership';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

console.log('Invisible Flow — WIN OVERLAY authoring harness (ownership-based, name-agnostic)\n');

// ---------------------------------------------------------------------------
// A. resolveWinMount — EXACTLY ONE winUpdate subscriber, every ownership combo.
// ---------------------------------------------------------------------------
console.log('A. resolveWinMount (exactly-one-subscriber invariant):');
const bools = [false, true];
let combos = 0;
for (const flowV2DrivesScreens of bools)
	for (const flowOwnsSetWin of bools)
		for (const basegameOverlaysHasCodedWinGate of bools) {
			combos += 1;
			const ctx = { flowV2DrivesScreens, flowOwnsSetWin, basegameOverlaysHasCodedWinGate };
			const mount = resolveWinMount(ctx);
			if (flowV2DrivesScreens) {
				// Under v2 the engine participates: the mounted gate OR a coded Win/WinGate in
				// basegameOverlays is the sole `winUpdate` subscriber.
				const subscribers = (mount ? 1 : 0) + (basegameOverlaysHasCodedWinGate ? 1 : 0);
				assert(
					`v2: subscribers === 1 for ${JSON.stringify(ctx)} ⇒ ${JSON.stringify(mount)}`,
					subscribers === 1,
					`got ${subscribers}`,
				);
			} else {
				// A non-flow / book-events-only game NEVER mounts the engine gate — the coded composer
				// owns the overlay, byte-identical to today (parity).
				assert(`non-v2: engine mounts NOTHING for ${JSON.stringify(ctx)}`, mount === null);
			}
		}
console.log(`  (${combos} combos)`);

// Spot-check the load-bearing routes read the way the design says.
assert(
	'v2 + owns setWin (no coded gate) ⇒ headless driver (author owns dim/text/art, ANY name)',
	resolveWinMount({
		flowV2DrivesScreens: true,
		flowOwnsSetWin: true,
		basegameOverlaysHasCodedWinGate: false,
	}) === 'driver',
);
assert(
	'v2 + does NOT own setWin (no coded gate) ⇒ full gate (coded setWin handler drives it — parity)',
	resolveWinMount({
		flowV2DrivesScreens: true,
		flowOwnsSetWin: false,
		basegameOverlaysHasCodedWinGate: false,
	}) === 'gate',
);
assert(
	'v2 + coded Win/WinGate in basegameOverlays ⇒ NO engine mount, even when owning setWin',
	resolveWinMount({
		flowV2DrivesScreens: true,
		flowOwnsSetWin: true,
		basegameOverlaysHasCodedWinGate: true,
	}) === null,
);
assert(
	'non-flow ⇒ NO engine mount (byte-parity, whatever the other flags)',
	resolveWinMount({
		flowV2DrivesScreens: false,
		flowOwnsSetWin: true,
		basegameOverlaysHasCodedWinGate: false,
	}) === null,
);
// PARITY CONTROL: today's Borut remake (v2 drives screens, does NOT own setWin) + apps/lines coded
// path must mount EXACTLY what `main` did — the full `'gate'` under v2 / nothing off-flow.
assert(
	"PARITY: v2 driving but NOT owning setWin (Borut remake today) ⇒ 'gate' (was `<WinGate>` on main)",
	resolveWinMount({
		flowV2DrivesScreens: true,
		flowOwnsSetWin: false,
		basegameOverlaysHasCodedWinGate: false,
	}) === 'gate',
);

// ---------------------------------------------------------------------------
// B. winCountUpComplete arms the tap / reveals the prompt only AFTER the count-up.
// ---------------------------------------------------------------------------
console.log('\nB. winCountUpComplete gates tap-arm + prompt reveal:');
const COMPLETE = 'winCountUpComplete';
assert('tap NOT armed before count-up completes', isTapArmed(COMPLETE, {}) === false);
assert('prompt hidden before count-up completes', isNodeRevealed(COMPLETE, {}) === false);
const doneBus = { [COMPLETE]: 1 };
assert('tap armed after count-up completes', isTapArmed(COMPLETE, doneBus) === true);
assert('prompt revealed after count-up completes', isNodeRevealed(COMPLETE, doneBus) === true);
assert('un-gated tap armed on mount (parity)', isTapArmed(undefined, {}) === true);

// ---------------------------------------------------------------------------
// C. The `countUpComplete` latch makes tap-arm ORDER-INDEPENDENT (the stuck-container fix).
// Models record-on-fire-only-while-subscribed + seed-on-subscribe against the REAL `isTapArmed`.
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
{
	const latch = { countUpComplete: false };
	const a = armModel(latch, false); // WITHOUT the seed
	latch.countUpComplete = true;
	a.broadcast();
	a.subscribe();
	assert(
		'no seed + completion-before-subscribe ⇒ tap NEVER arms (reproduces the stuck container)',
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
{
	const latch = { countUpComplete: false };
	const a = armModel(latch, true);
	a.subscribe();
	latch.countUpComplete = true;
	a.broadcast();
	assert('real win (subscribe-before-broadcast) arms', a.armed() === true);
}

// ---------------------------------------------------------------------------
// E. REPEAT win — the latch must RESET when the prior win hides, else the SECOND win's fresh tap
// (mounted by `showContainer` BEFORE that win's `winShow`) seeds off win #1's stale `true` and arms
// instantly, before its own count-up. Models the WinGate `winHide` reset (the fix for the
// second-time-only bug). Win #1 leaves `countUpComplete = true`; win #2 mounts a FRESH subscriber.
// ---------------------------------------------------------------------------
console.log('\nE. repeat win: the latch resets on hide so win #2 does not pre-arm:');
{
	// WITHOUT the reset — reproduces the reported bug: win #2's tap arms on mount (stale true).
	const latch = { countUpComplete: true }; // left true by win #1's completed count-up
	const a = armModel(latch, true);
	a.subscribe(); // win #2's showContainer mounts the tap BEFORE its winShow
	assert('no reset-on-hide + repeat win ⇒ tap PRE-ARMS on mount (the bug)', a.armed() === true);
}
{
	// WITH the reset — winHide cleared the latch before win #2's container mounts, so it stays inert
	// until win #2's own count-up completes.
	const latch = { countUpComplete: true };
	latch.countUpComplete = false; // WinGate.winHide reset, before win #2 shows
	const a = armModel(latch, true);
	a.subscribe();
	assert('reset-on-hide + repeat win ⇒ tap NOT armed on mount', a.armed() === false);
	latch.countUpComplete = true; // win #2's count-up completes
	a.broadcast();
	assert('reset-on-hide + repeat win ⇒ tap arms after win #2 count-up', a.armed() === true);
}

console.log(failed ? '\nWIN overlay harness: FAIL' : '\nWIN overlay harness: PASS');
if (failed) process.exit(1);
