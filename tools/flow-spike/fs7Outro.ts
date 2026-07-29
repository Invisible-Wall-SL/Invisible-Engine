/**
 * Invisible Flow — FS-7 free-spin OUTRO authoring harness (design doc §14, outro round-gate).
 *
 *   pnpm --filter flow-spike run fs7outro
 *
 * Proves, HEADLESSLY against the REAL apps/lines modules, the FS-7 outro seam that lets an author
 * rebuild the free-spin outro entirely from primitives (own spine / count text / big-small art / tap)
 * while the engine keeps only the LOAD-BEARING count-up driver:
 *
 *  A. `hasAuthoredFreeSpinOutro` — the v2-applicable "the outro scene is author-rebuilt" test that
 *     routes to the HEADLESS driver vs the full gate. PARITY: a scene that binds ONLY the coded
 *     `FreeSpinOutroVisual` (the driven seed) — or nothing, or no scene — reads FALSE ⇒ the full
 *     `<FreeSpinOutroGate>` stays ⇒ Book of Borut byte-identical. An author-placed node ⇒ TRUE.
 *
 *  B. `resolveFreeSpinOutroMount` — decision B's NON-NEGOTIABLE invariant: across the two engine
 *     mount bands PLUS Borut's own composer, there is ALWAYS EXACTLY ONE `freeSpinOutroCountUp`
 *     subscriber, for EVERY combination of (flowV2DrivesScreens, freeSpinOutroHasCodedGate,
 *     freeSpinOutroAuthored, ownsOutro). Two would hang the round; zero would no-op the count-up.
 *
 *  C. The win-level fired signals (`freeSpinOutroBigWin` / `freeSpinOutroSmallWin`) drive the pure
 *     `isNodeRevealed` gate exactly as the per-instance bus records them — so authored big/small art
 *     gated by `hiddenUntilSignal` reveals on the matching tier and stays hidden on the other.
 *
 *  D. The count-up-complete fired signal (`freeSpinOutroCountUpComplete`, broadcast by the driver when
 *     `startCountUp()` resolves) arms a `tapArmAfterSignal` tap + reveals a `hiddenUntilSignal` prompt
 *     ONLY after the count-up finishes — the FS-7 follow-up seam that gates the tap on the count.
 *
 * NOTE: the FS-7 baked coin fountain was REMOVED from the driver (the author places their own), so the
 * mount/subscriber invariants in B are unaffected — routing never depended on the fountain.
 */

import { isNodeRevealed, isTapArmed } from '../../packages/engine-layout/src/lib/signalGates';
import type { Scene } from '../../packages/engine-layout/src/lib/types';
import {
	hasAuthoredFreeSpinOutro,
	resolveFreeSpinOutroMount,
} from '../../apps/lines/src/game/freeSpinOwnership';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

/** Build a minimal `freeSpinOutro` scene from top-level node descriptors. */
const outroScene = (nodes: Array<{ bind?: string; kind?: string }>): Scene =>
	({
		id: 'freeSpinOutro',
		nodes: nodes.map((n, i) => ({
			id: `n${i}`,
			kind: n.kind ?? (n.bind ? 'bind' : 'componentInstance'),
			...(n.bind ? { bind: { component: n.bind } } : {}),
		})),
	}) as unknown as Scene;

console.log('Invisible Flow — FS-7 free-spin OUTRO authoring harness\n');

// ---------------------------------------------------------------------------
// A. hasAuthoredFreeSpinOutro — routing + parity.
// ---------------------------------------------------------------------------
console.log('A. hasAuthoredFreeSpinOutro (author-rebuilt detection + parity):');
assert(
	'no freeSpinOutro scene ⇒ false (parity)',
	hasAuthoredFreeSpinOutro([{ id: 'basegame', nodes: [] } as unknown as Scene]) === false,
);
assert('empty scene ⇒ false (parity)', hasAuthoredFreeSpinOutro([outroScene([])]) === false);
assert(
	'binds only FreeSpinOutroVisual (driven seed) ⇒ false ⇒ full gate kept',
	hasAuthoredFreeSpinOutro([outroScene([{ bind: 'FreeSpinOutroVisual' }])]) === false,
);
assert(
	'binds FreeSpinOutro composer ⇒ false',
	hasAuthoredFreeSpinOutro([outroScene([{ bind: 'FreeSpinOutro' }])]) === false,
);
assert(
	'binds bare FreeSpinOutroGate ⇒ false',
	hasAuthoredFreeSpinOutro([outroScene([{ bind: 'FreeSpinOutroGate' }])]) === false,
);
assert(
	'author-placed componentInstance ⇒ TRUE ⇒ headless driver',
	hasAuthoredFreeSpinOutro([outroScene([{ kind: 'componentInstance' }])]) === true,
);
assert(
	'author sprite alongside the coded visual ⇒ TRUE (mixed rebuild)',
	hasAuthoredFreeSpinOutro([outroScene([{ bind: 'FreeSpinOutroVisual' }, { kind: 'sprite' }])]) ===
		true,
);

// ---------------------------------------------------------------------------
// B. resolveFreeSpinOutroMount — EXACTLY ONE freeSpinOutroCountUp subscriber, every combo.
// ---------------------------------------------------------------------------
console.log('\nB. resolveFreeSpinOutroMount (exactly-one-subscriber invariant):');
const bools = [false, true];
let combos = 0;
for (const flowV2DrivesScreens of bools)
	for (const freeSpinOutroHasCodedGate of bools)
		for (const freeSpinOutroAuthored of bools)
			for (const ownsOutro of bools) {
				// v1 (`ownsOutro`) and v2 (`flowV2DrivesScreens`) are mutually exclusive by construction
				// (`resolveFlowOwnsFreeSpins` is inert under v2), so skip the impossible pair.
				if (flowV2DrivesScreens && ownsOutro) continue;
				combos += 1;
				const ctx = {
					flowV2DrivesScreens,
					freeSpinOutroHasCodedGate,
					freeSpinOutroAuthored,
					ownsOutro,
				};
				const m = resolveFreeSpinOutroMount(ctx);
				// The composer gate mounts through Borut's own container (not either engine band) when a
				// v2 flow drives + the scene still binds a coded gate.
				const composer = flowV2DrivesScreens && freeSpinOutroHasCodedGate ? 1 : 0;
				const subscribers = (m.band ? 1 : 0) + (m.top ? 1 : 0) + composer;
				assert(
					`subscribers === 1 for ${JSON.stringify(ctx)} ⇒ ${JSON.stringify(m)}`,
					subscribers === 1,
					`got ${subscribers}`,
				);
				// The two engine bands are never BOTH occupied (would double the subscriber / dim).
				assert(`at most one engine band for ${JSON.stringify(ctx)}`, !(m.band && m.top));
			}
console.log(`  (${combos} reachable combos)`);

// Spot-check the load-bearing routes read the way the design says.
assert(
	'v2 + author-rebuilt ⇒ headless driver at the container band',
	JSON.stringify(
		resolveFreeSpinOutroMount({
			flowV2DrivesScreens: true,
			freeSpinOutroHasCodedGate: false,
			freeSpinOutroAuthored: true,
			ownsOutro: false,
		}),
	) === JSON.stringify({ band: 'driver', top: null }),
);
assert(
	'v2 + driven seed (coded visual only) ⇒ full gate at the container band',
	JSON.stringify(
		resolveFreeSpinOutroMount({
			flowV2DrivesScreens: true,
			freeSpinOutroHasCodedGate: false,
			freeSpinOutroAuthored: false,
			ownsOutro: false,
		}),
	) === JSON.stringify({ band: 'gate', top: null }),
);
assert(
	'v2 + Borut composer ⇒ NO engine mount (composer owns it)',
	JSON.stringify(
		resolveFreeSpinOutroMount({
			flowV2DrivesScreens: true,
			freeSpinOutroHasCodedGate: true,
			freeSpinOutroAuthored: false,
			ownsOutro: false,
		}),
	) === JSON.stringify({ band: null, top: null }),
);
assert(
	'v1 ownsOutro ⇒ driver-transfer at the top band',
	JSON.stringify(
		resolveFreeSpinOutroMount({
			flowV2DrivesScreens: false,
			freeSpinOutroHasCodedGate: false,
			freeSpinOutroAuthored: true,
			ownsOutro: true,
		}),
	) === JSON.stringify({ band: null, top: 'driver-transfer' }),
);
assert(
	'un-authored / non-flow ⇒ full gate at the top band (byte-parity)',
	JSON.stringify(
		resolveFreeSpinOutroMount({
			flowV2DrivesScreens: false,
			freeSpinOutroHasCodedGate: false,
			freeSpinOutroAuthored: false,
			ownsOutro: false,
		}),
	) === JSON.stringify({ band: null, top: 'gate' }),
);

// ---------------------------------------------------------------------------
// C. win-level fired signals gate authored big/small art via isNodeRevealed.
// ---------------------------------------------------------------------------
console.log('\nC. freeSpinOutroBigWin / freeSpinOutroSmallWin gate reveal:');
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
// Ungated node (no hiddenUntilSignal) is always revealed (parity — the count text / spine).
assert('ungated node always revealed', isNodeRevealed(undefined, {}) === true);

// ---------------------------------------------------------------------------
// D. freeSpinOutroCountUpComplete arms the tap / reveals the prompt only AFTER the count-up.
// ---------------------------------------------------------------------------
console.log('\nD. freeSpinOutroCountUpComplete gates tap-arm + prompt reveal:');
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

console.log(failed ? '\nFS-7 outro harness: FAIL' : '\nFS-7 outro harness: PASS');
if (failed) process.exit(1);
