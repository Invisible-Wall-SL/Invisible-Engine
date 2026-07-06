/**
 * Invisible Flow — FS-7 early-mount + take-once harness (design doc §14, intro round-gate).
 *
 *   pnpm --filter flow-spike run fs7
 *
 * Proves, HEADLESSLY against the REAL `createFlowInterpreter`, the FS-7 intro seam: an overlay that
 * EARLY-MOUNTS during its own event's dispatch (via `activateForBookEvent`, wired to the choreography's
 * `*Show` broadcast) AND then SELF-COMPLETES mid-dispatch (its tap-to-continue releases the round-block
 * AND fires its `complete` pin) must NOT be re-activated by `dispatchBookEvent`'s own post-dispatch
 * `onBookEvent`. That is the "take-once" dedup: a book event whose transition was already taken early is
 * not taken again after dispatch — otherwise the overlay pops back at the end and sticks (the exact
 * "stays forever" regression this guards against).
 *
 * It also proves PARITY: an event that does NOT early-mount still takes its layer transition through the
 * normal post-dispatch path (the dedup only ever fires for an early-mounted event type).
 *
 * Determinism: a virtual `waitForTimeout` (resolves immediately); the round-block is a manual deferred
 * the harness releases explicitly, so the mid-dispatch interleaving is reproducible run-to-run.
 */

import {
	createFlowInterpreter,
	type FlowDoc,
	type FlowInterpreter,
	type FlowRuntime,
	type MountableScene,
} from 'engine-flow';

const makeRuntime = (): FlowRuntime => ({
	emitter: {
		broadcast: () => {},
		broadcastAsync: () => Promise.resolve([]),
	},
	timeScale: () => 1,
	waitForTimeout: () => Promise.resolve(),
});

// apps/lines-shaped free-spin intro: `basegame` persists; `freeSpinTrigger` LAYERS `freeSpinIntro`
// over it; the intro's Complete pin HANDS OFF back to the base. Mirrors LINES_FLOW_FREESPIN_DOC.
const flowDoc: FlowDoc = {
	version: 1,
	screens: [{ id: 'basegame', initial: true }, { id: 'freeSpinIntro' }, { id: 'winCelebration' }],
	transitions: [
		{ id: 't1', from: 'basegame', to: 'freeSpinIntro', trigger: { kind: 'bookEvent', event: 'freeSpinTrigger' } },
		{ id: 't2', from: 'freeSpinIntro', to: 'basegame', trigger: { kind: 'complete' } },
		// A second LAYER overlay driven the NORMAL way (no early-mount) — the parity control.
		{ id: 't3', from: 'basegame', to: 'winCelebration', trigger: { kind: 'bookEvent', event: 'setWin' } },
		{ id: 't4', from: 'winCelebration', to: 'basegame', trigger: { kind: 'complete' } },
	],
};

const scenes: Record<string, MountableScene> = {
	basegame: { id: 'basegame', space: 'game' },
	freeSpinIntro: { id: 'freeSpinIntro', space: 'game' },
	winCelebration: { id: 'winCelebration', space: 'game' },
};
const resolveScene = (id: string): MountableScene | undefined => scenes[id];

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) {
		console.log(`  PASS  ${label}`);
	} else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Flush the pending microtask/macrotask queue so a fire-and-forget early-mount + the coded
 *  handler run up to their next real await. `setTimeout(0)` drains microtasks queued so far. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const main = async () => {
	console.log('Invisible Flow — FS-7 early-mount + take-once harness\n');

	// The round-block deferred the FS-7 holder awaits (its tap-to-continue releases it). The coded
	// `freeSpinTrigger` handler stands in for the intro choreography: early-mount on `*Show`, then
	// block on the round-gate until the tap, exactly like flowDoc.ts L119 → L123.
	let releaseRoundBlock: (() => void) | undefined;
	let interp: FlowInterpreter<{ type: string }, undefined>;

	const codedHandlers = {
		freeSpinTrigger: async () => {
			// L119 `broadcast('freeSpinIntroShow')` → early-mount the authored overlay (fire-and-forget,
			// as the real emitter subscriber does).
			void interp.activateForBookEvent({ type: 'freeSpinTrigger' });
			// L123 `broadcastAwait('freeSpinIntroUpdate')` → hold the round until the tap.
			await new Promise<void>((resolve) => (releaseRoundBlock = resolve));
		},
		setWin: async () => {
			// A plain event with no early-mount — its transition rides the NORMAL post-dispatch path.
		},
	};

	interp = createFlowInterpreter<{ type: string }, undefined>({
		flowDoc,
		runtime: makeRuntime(),
		resolveScene,
		codedHandlers,
	});
	await interp.start();
	assert('boot: active set is [basegame]', eq(interp.activeScreenIds, ['basegame']));

	// --- A. FS-7 intro: early-mount, self-complete mid-dispatch, NO re-mount after dispatch ---
	console.log('\nA. FS-7 intro round-gate (early-mount + take-once):');
	const dispatchP = interp.dispatchBookEvent({ type: 'freeSpinTrigger' }, undefined);
	await flush(); // let the coded handler early-mount then park on the round-block

	assert(
		'early-mount: freeSpinIntro is active DURING dispatch (spine visible while the round holds)',
		eq(interp.activeScreenIds, ['basegame', 'freeSpinIntro']),
		JSON.stringify(interp.activeScreenIds),
	);

	// The player's tap: completes the active screen (its `complete` edge → back to base) — happens
	// mid-dispatch, so `freeSpinIntro` is GONE before dispatch returns.
	await interp.completeActiveScreen();
	assert(
		'tap completes freeSpinIntro mid-dispatch ⇒ active set back to [basegame]',
		eq(interp.activeScreenIds, ['basegame']),
		JSON.stringify(interp.activeScreenIds),
	);

	// Release the round-block so the (simulated) choreography finishes and dispatch returns.
	releaseRoundBlock?.();
	await dispatchP;

	assert(
		'THE FIX: no re-mount after dispatch — active set STAYS [basegame] (not [basegame, freeSpinIntro])',
		eq(interp.activeScreenIds, ['basegame']),
		JSON.stringify(interp.activeScreenIds),
	);

	// --- B. Parity: a non-early-mounted event still layers via the normal post-dispatch path ---
	console.log('\nB. Parity — a normal (non-early-mount) layer event is unaffected by the dedup:');
	await interp.dispatchBookEvent({ type: 'setWin' }, undefined);
	assert(
		'setWin took its layer transition post-dispatch (dedup never armed for it)',
		eq(interp.activeScreenIds, ['basegame', 'winCelebration']),
		JSON.stringify(interp.activeScreenIds),
	);

	// --- C. Take-once is per-dispatch: a SECOND freeSpinTrigger round early-mounts + dedups again ---
	console.log('\nC. Take-once re-arms each round (a second free-spin trigger behaves identically):');
	await interp.completeActiveScreen(); // dismiss the win overlay back to base
	const dispatchP2 = interp.dispatchBookEvent({ type: 'freeSpinTrigger' }, undefined);
	await flush();
	assert('round 2 early-mount: freeSpinIntro active again', eq(interp.activeScreenIds, ['basegame', 'freeSpinIntro']));
	await interp.completeActiveScreen();
	releaseRoundBlock?.();
	await dispatchP2;
	assert(
		'round 2: no re-mount after dispatch either — [basegame]',
		eq(interp.activeScreenIds, ['basegame']),
		JSON.stringify(interp.activeScreenIds),
	);

	console.log(`\n${failed ? 'FS-7 HARNESS: FAILED' : 'FS-7 HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
