/**
 * Invisible Flow — FS-4 free-spin RETRIGGER authorability harness (design doc §14, FS-4).
 *
 *   pnpm --filter flow-spike run fs4
 *
 * Proves, HEADLESSLY, that the "extra free spins won mid-feature" retrigger is AUTHORABLE online:
 * the `freeSpinRetrigger` book event is surfaced to the v2 vocabulary (so it projects a `gameSignals`
 * signal an author can wire to a "+N extra free spins" celebration + tap-to-continue).
 *
 *  1. VOCAB / PIN PROJECTION (engine-flow-v2) — `derivePins(gameSignals, { vocab: BOOK_OF_VOCAB })`
 *     yields an exec-out `freeSpinRetrigger` (book event → surfaced) with typed data-outs
 *     `freeSpinRetrigger.extraFs` (int) + `freeSpinRetrigger.total` (int). This is the pin the owner
 *     wires the celebration screen off.
 *  2. RUNTIME AUTHORING CHAIN (engine-flow-v2) — the exact pattern the owner authors:
 *       gameSignals ─freeSpinRetrigger→ showContainer(retrigger) ─exec→ action showRetriggerCount
 *                    └(data) freeSpinRetrigger.extraFs ─────────────────→ (count)
 *     `runFlowEvent(doc, ctx, 'freeSpinRetrigger', { extraFs: 10, total: 22 })` shows the container
 *     and the "+N" readout receives `count: 10` (the payload resolved THROUGH the gameSignals data-out).
 *  3. The v1 `LINES_FLOW_FREESPIN_DOC` fixture's LAYER edge into `freeSpinRetrigger` triggers on the
 *     `freeSpinRetrigger` book event (the facade's real event type), NOT the phantom `retrigger` it
 *     named while inert.
 */

import {
	BOOK_OF_VOCAB,
	derivePins,
	runFlowEvent,
	type FlowDoc as FlowDocV2,
	type FlowV2Env,
	type FunctionLibraryDoc,
	type GameSignalsNode,
	type Pin,
	type PinContext,
	type RunContext,
} from 'engine-flow-v2';

import { LINES_FLOW_FREESPIN_DOC } from '../../apps/lines/src/game/flowDoc';

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------
let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const execOutIds = (pins: Pin[]): string[] =>
	pins.filter((p) => p.dir === 'out' && p.kind === 'exec').map((p) => p.id);
const findDataOut = (pins: Pin[], id: string): Pin | undefined =>
	pins.find((p) => p.id === id && p.dir === 'out' && p.kind === 'data');

// ---------------------------------------------------------------------------
// The v2 authoring doc for parts 1 & 2: ONE gameSignals node whose `freeSpinRetrigger` exec-out layers
// the retrigger container, and whose `freeSpinRetrigger.extraFs` data-out feeds the "+N" readout action.
// ---------------------------------------------------------------------------
const SIGNALS: GameSignalsNode = { id: 'signals', kind: 'gameSignals', pos: { x: 0, y: 0 } };

const DOC: FlowDocV2 = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			SIGNALS,
			{ id: 'showRt', kind: 'showContainer', pos: { x: 300, y: 0 }, ref: 'retrigger' },
			{
				id: 'showCount',
				kind: 'action',
				pos: { x: 600, y: 0 },
				ref: 'showRetriggerCount',
				inputs: { count: { kind: 'wire' } },
			},
		],
		exec: [
			{ from: { node: 'signals', pin: 'freeSpinRetrigger' }, to: { node: 'showRt', pin: 'exec' } },
			{ from: { node: 'showRt', pin: 'exec' }, to: { node: 'showCount', pin: 'exec' } },
		],
		data: [
			{
				from: { node: 'signals', pin: 'freeSpinRetrigger.extraFs' },
				to: { node: 'showCount', pin: 'count' },
			},
		],
	},
	containers: [{ id: 'retrigger', sceneId: 'freeSpinRetrigger', z: 20 }],
};

const makeRecordingEnv = () => {
	const log: string[] = [];
	const env: FlowV2Env = {
		async effect(name, payload) {
			log.push(`effect ${name}(${JSON.stringify(payload)})`);
		},
		async broadcast(cue, payload) {
			const extra = Object.keys(payload).length ? ` ${JSON.stringify(payload)}` : '';
			log.push(`broadcast ${cue}${extra}`);
		},
		async waitForTimeout(ms) {
			log.push(`delay ${ms}`);
			await Promise.resolve();
		},
		timeScale: () => 1,
		showContainer(id, z) {
			log.push(`show ${id}@${z}`);
		},
		hideContainer(id) {
			log.push(`hide ${id}`);
		},
		engineRead: () => undefined,
	};
	return { env, log };
};

const main = async () => {
	console.log('Invisible Flow — FS-4 free-spin retrigger authorability harness\n');

	// --- 1. the vocab surfaces `freeSpinRetrigger` as a gameSignals pin with typed data-outs ---
	console.log('1. derivePins(gameSignals) surfaces `freeSpinRetrigger` (book) + typed data-outs:');
	{
		const pinCtx: PinContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY };
		const pins = derivePins(SIGNALS, pinCtx);
		const outs = execOutIds(pins);
		assert('has exec-out `freeSpinRetrigger`', outs.includes('freeSpinRetrigger'), outs.join(','));

		const extraFs = findDataOut(pins, 'freeSpinRetrigger.extraFs');
		const total = findDataOut(pins, 'freeSpinRetrigger.total');
		assert(
			'data-out `freeSpinRetrigger.extraFs` typed int',
			extraFs?.dataType?.t === 'int',
			JSON.stringify(extraFs?.dataType),
		);
		assert(
			'data-out `freeSpinRetrigger.total` typed int',
			total?.dataType?.t === 'int',
			JSON.stringify(total?.dataType),
		);
	}

	// --- 2. runtime: firing `freeSpinRetrigger` layers the screen; `extraFs` resolves to the readout ---
	console.log('\n2. runFlowEvent(freeSpinRetrigger) shows the screen; extraFs resolves through:');
	{
		const { env, log } = makeRecordingEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		await runFlowEvent(DOC, ctx, 'freeSpinRetrigger', { extraFs: 10, total: 22 });
		const expected = [
			'show retrigger@20',
			`effect showRetriggerCount(${JSON.stringify({ count: 10 })})`,
		];
		assert(
			'records `show retrigger@20` then `effect showRetriggerCount({count:10})`, in order',
			eq(log, expected),
			log.join(' | '),
		);
	}

	// --- 3. the v1 fixture's LAYER edge fires on the REAL event ---
	console.log('\n3. LINES_FLOW_FREESPIN_DOC — the LAYER edge triggers on the real event:');
	{
		const layerEdge = LINES_FLOW_FREESPIN_DOC.transitions.find(
			(t) => t.to === 'freeSpinRetrigger' && t.trigger.kind === 'bookEvent',
		);
		assert(
			'LAYER edge into freeSpinRetrigger triggers on the `freeSpinRetrigger` book event',
			layerEdge?.trigger.kind === 'bookEvent' && layerEdge.trigger.event === 'freeSpinRetrigger',
			JSON.stringify(layerEdge?.trigger),
		);
	}

	console.log(`\n${failed ? 'FS-4 RETRIGGER HARNESS: FAILED' : 'FS-4 RETRIGGER HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
