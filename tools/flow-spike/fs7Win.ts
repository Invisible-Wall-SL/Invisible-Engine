/**
 * Invisible Flow — WIN OVERLAY authoring harness (design doc §14, the win-overlay twin of the FS-7
 * outro round-gate).
 *
 *   pnpm --filter flow-spike run fs7win
 *
 * Proves, HEADLESSLY against the REAL apps/lines modules, the seam that lets an author rebuild the WIN
 * overlay entirely from primitives (own dim / count text / spine / tap) while the engine keeps only
 * the LOAD-BEARING count-up driver:
 *
 *  A. `hasAuthoredWin` / `bigWinHasCodedWinGate` — the "the `bigWin` scene is author-rebuilt" test that
 *     routes to the HEADLESS driver vs the full gate, and the "the `bigWin` scene binds a coded
 *     `Win`/`WinGate`" test that makes the engine gate stand down. PARITY: a scene that binds ONLY the
 *     coded `WinVisual` (the driven seed) — or nothing, or no scene — reads NOT-authored + no-coded-gate
 *     ⇒ the full `<WinGate>` stays ⇒ driven-seed / Borut byte-identical. An author-placed node ⇒ driver.
 *
 *  B. `resolveWinMount` — the NON-NEGOTIABLE invariant: under a v2 flow there is ALWAYS EXACTLY ONE
 *     `winUpdate` subscriber across the engine gate PLUS a coded `Win`/`WinGate` gate, for EVERY
 *     combination of (flowV2DrivesScreens, winHasCodedGate, winAuthored). Two would hang the round; zero
 *     would no-op the count-up. A non-flow game mounts NOTHING (the coded composer owns it — parity).
 *
 *  C. The count-up-complete fired signal (`winCountUpComplete`, broadcast by `WinGate` when
 *     `startCountUp()` resolves) arms a `tapArmAfterSignal` tap + reveals a `hiddenUntilSignal` prompt
 *     ONLY after the count-up finishes — the seam that gates the tap on the count.
 *
 *  D. The `winState.countUpComplete` latch makes tap-arm ORDER-INDEPENDENT (a ZERO / instant count-up
 *     finishes in the same tick the container mounts, so the broadcast can fire before the subscribe).
 */

import { isNodeRevealed, isTapArmed } from '../../packages/engine-layout/src/lib/signalGates';
import type { Scene } from '../../packages/engine-layout/src/lib/types';
import {
	bigWinHasCodedWinGate,
	hasAuthoredWin,
	resolveWinMount,
} from '../../apps/lines/src/game/winOwnership';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

/** Build a minimal `bigWin` scene from top-level node descriptors. */
const bigWinScene = (nodes: Array<{ bind?: string; kind?: string }>): Scene =>
	({
		id: 'bigWin',
		nodes: nodes.map((n, i) => ({
			id: `n${i}`,
			kind: n.kind ?? (n.bind ? 'bind' : 'componentInstance'),
			...(n.bind ? { bind: { component: n.bind } } : {}),
		})),
	}) as unknown as Scene;

console.log('Invisible Flow — WIN OVERLAY authoring harness\n');

// ---------------------------------------------------------------------------
// A. hasAuthoredWin / bigWinHasCodedWinGate — routing + parity.
// ---------------------------------------------------------------------------
console.log('A. hasAuthoredWin + bigWinHasCodedWinGate (author-rebuilt / coded-gate detection):');
assert(
	'no bigWin scene ⇒ not authored (parity)',
	hasAuthoredWin([{ id: 'basegame', nodes: [] } as unknown as Scene]) === false,
);
assert('empty scene ⇒ not authored (parity)', hasAuthoredWin([bigWinScene([])]) === false);
assert(
	'binds only WinVisual (driven seed) ⇒ not authored ⇒ full gate kept',
	hasAuthoredWin([bigWinScene([{ bind: 'WinVisual' }])]) === false,
);
assert(
	'binds Win composer ⇒ not authored',
	hasAuthoredWin([bigWinScene([{ bind: 'Win' }])]) === false,
);
assert(
	'binds bare WinGate ⇒ not authored',
	hasAuthoredWin([bigWinScene([{ bind: 'WinGate' }])]) === false,
);
assert(
	'author-placed componentInstance ⇒ AUTHORED ⇒ headless driver',
	hasAuthoredWin([bigWinScene([{ kind: 'componentInstance' }])]) === true,
);
assert(
	'author sprite alongside the coded visual ⇒ AUTHORED (mixed rebuild)',
	hasAuthoredWin([bigWinScene([{ bind: 'WinVisual' }, { kind: 'sprite' }])]) === true,
);
// bigWinHasCodedWinGate: only the SUBSCRIBER gates (Win/WinGate), never the pure WinVisual.
assert(
	'WinVisual-only ⇒ NO coded gate (visual does not subscribe)',
	bigWinHasCodedWinGate([bigWinScene([{ bind: 'WinVisual' }])]) === false,
);
assert(
	'binds Win composer ⇒ coded gate present',
	bigWinHasCodedWinGate([bigWinScene([{ bind: 'Win' }])]) === true,
);
assert(
	'binds WinGate ⇒ coded gate present',
	bigWinHasCodedWinGate([bigWinScene([{ bind: 'WinGate' }])]) === true,
);
assert(
	'author sprite only ⇒ NO coded gate',
	bigWinHasCodedWinGate([bigWinScene([{ kind: 'sprite' }])]) === false,
);
assert('no bigWin scene ⇒ NO coded gate (parity)', bigWinHasCodedWinGate([]) === false);

// ---------------------------------------------------------------------------
// B. resolveWinMount — EXACTLY ONE winUpdate subscriber, every combo.
// ---------------------------------------------------------------------------
console.log('\nB. resolveWinMount (exactly-one-subscriber invariant):');
const bools = [false, true];
let combos = 0;
for (const flowV2DrivesScreens of bools)
	for (const winHasCodedGate of bools)
		for (const winAuthored of bools) {
			combos += 1;
			const ctx = { flowV2DrivesScreens, winHasCodedGate, winAuthored };
			const mount = resolveWinMount(ctx);
			if (flowV2DrivesScreens) {
				// Under v2 the engine participates: the mounted gate OR a coded Win/WinGate is the sole
				// `winUpdate` subscriber.
				const subscribers = (mount ? 1 : 0) + (winHasCodedGate ? 1 : 0);
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
	'v2 + author-rebuilt (no coded gate) ⇒ headless driver',
	resolveWinMount({ flowV2DrivesScreens: true, winHasCodedGate: false, winAuthored: true }) ===
		'driver',
);
assert(
	'v2 + driven seed (no coded gate, not rebuilt) ⇒ full gate',
	resolveWinMount({ flowV2DrivesScreens: true, winHasCodedGate: false, winAuthored: false }) ===
		'gate',
);
assert(
	'v2 + coded Win/WinGate binds it ⇒ NO engine mount (coded gate subscribes)',
	resolveWinMount({ flowV2DrivesScreens: true, winHasCodedGate: true, winAuthored: true }) === null,
);
assert(
	'non-flow ⇒ NO engine mount (byte-parity)',
	resolveWinMount({ flowV2DrivesScreens: false, winHasCodedGate: false, winAuthored: false }) ===
		null,
);

// End-to-end over the REAL scene helpers: the `bigWin` scene shape × the `basegameOverlays` coded-gate
// × v2 all fold into the SAME exactly-one invariant (mirrors how Game.svelte composes them).
console.log('\nB2. resolveWinMount over the real scene helpers (scene shape → mount):');
const sceneShapes: Array<{ label: string; scenes: Scene[] }> = [
	{ label: 'no bigWin scene', scenes: [] },
	{ label: 'WinVisual-only (driven seed)', scenes: [bigWinScene([{ bind: 'WinVisual' }])] },
	{ label: 'author-rebuilt', scenes: [bigWinScene([{ kind: 'componentInstance' }])] },
	{ label: 'binds coded WinGate', scenes: [bigWinScene([{ bind: 'WinGate' }])] },
];
for (const shape of sceneShapes)
	for (const basegameOverlaysHasCodedWinGate of bools) {
		const winAuthored = hasAuthoredWin(shape.scenes);
		const winHasCodedGate = basegameOverlaysHasCodedWinGate || bigWinHasCodedWinGate(shape.scenes);
		const mount = resolveWinMount({ flowV2DrivesScreens: true, winHasCodedGate, winAuthored });
		const subscribers = (mount ? 1 : 0) + (winHasCodedGate ? 1 : 0);
		assert(
			`v2 · ${shape.label} · overlaysCodedGate=${basegameOverlaysHasCodedWinGate} ⇒ ${JSON.stringify(mount)} (1 subscriber)`,
			subscribers === 1,
			`got ${subscribers}`,
		);
	}

// ---------------------------------------------------------------------------
// C. winCountUpComplete arms the tap / reveals the prompt only AFTER the count-up.
// ---------------------------------------------------------------------------
console.log('\nC. winCountUpComplete gates tap-arm + prompt reveal:');
const COMPLETE = 'winCountUpComplete';
assert('tap NOT armed before count-up completes', isTapArmed(COMPLETE, {}) === false);
assert('prompt hidden before count-up completes', isNodeRevealed(COMPLETE, {}) === false);
const doneBus = { [COMPLETE]: 1 };
assert('tap armed after count-up completes', isTapArmed(COMPLETE, doneBus) === true);
assert('prompt revealed after count-up completes', isNodeRevealed(COMPLETE, doneBus) === true);
assert('un-gated tap armed on mount (parity)', isTapArmed(undefined, {}) === true);

// ---------------------------------------------------------------------------
// D. The `countUpComplete` latch makes tap-arm ORDER-INDEPENDENT (the stuck-container fix).
// Models record-on-fire-only-while-subscribed + seed-on-subscribe against the REAL `isTapArmed`.
// ---------------------------------------------------------------------------
console.log('\nD. countUpComplete latch seeds a LATE subscriber (order-independent tap-arm):');
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

console.log(failed ? '\nWIN overlay harness: FAIL' : '\nWIN overlay harness: PASS');
if (failed) process.exit(1);
