/**
 * Invisible Flow v2 — GAME-SIGNALS harness (schema §6.2; the mechanic-signal source node).
 *
 *   pnpm --filter flow-spike run v2gamesignals
 *
 * Proves, HEADLESSLY, the ONE `gameSignals` node that surfaces the TEMPLATE's MECHANIC signals —
 * every vocab event whose `category` is `book` OR `lifecycle` (NOT `intent`; intents are the
 * container button pins, §6.1) — as exec-out + typed data-out pins, so an author wires presentation
 * off the game's own signals from ONE node instead of scattered per-event nodes.
 *
 * Two proofs, mirroring the container-event discipline (derive + fire):
 *   1. `derivePins(gameSignals, { vocab: BOOK_OF_VOCAB, library })` yields exec-outs for the
 *      book + lifecycle events (has `freeSpinTrigger`, `reveal`, `load`) and NOT for intents (no
 *      `spin`, no `increase`), and `freeSpinTrigger` contributes typed data-outs
 *      `freeSpinTrigger.totalFs` (int) + `freeSpinTrigger.positions` (list<Position>).
 *   2. runtime firing — a `gameSignals` node whose `freeSpinTrigger` exec-out wires into
 *      `showContainer freespin`, with its data-out `freeSpinTrigger.totalFs` wired into an
 *      `action setFreeSpinCounterTotal(total)` param:
 *
 *        gameSignals ─freeSpinTrigger→ showContainer(freespin) ─exec→ action setFreeSpinCounterTotal
 *                     └(data) freeSpinTrigger.totalFs ──────────────→ (total)
 *
 *      `runFlowEvent(doc, ctx, 'freeSpinTrigger', { totalFs: 10, positions: [] })` MUST record the
 *      chain in order AND the action MUST receive `total: 10` (payload resolved THROUGH the
 *      gameSignals data-out). An unknown / unsurfaced event is a parity-safe no-op.
 *
 * A recording `FlowV2Env` logs every effect / broadcast / show / hide call in order. Uses the REAL
 * `book-of` vocabulary (the tagged categories) — so this asserts the vocab's own tagging is honest.
 *
 * Prints PASS/FAIL per assertion + a final `V2 GAME-SIGNALS HARNESS: PASSED`.
 */

import {
	BOOK_OF_VOCAB,
	derivePins,
	runFlowEvent,
	type FlowDoc,
	type FlowV2Env,
	type FunctionLibraryDoc,
	type GameSignalsNode,
	type Pin,
	type PinContext,
	type RunContext,
} from 'engine-flow-v2';

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

// ---------------------------------------------------------------------------
// The FlowDoc: a single `gameSignals` node. Its `freeSpinTrigger` exec-out wires into
// `showContainer(freespin)` → `action setFreeSpinCounterTotal`, and its data-out
// `freeSpinTrigger.totalFs` feeds the action's `total` param. The gameSignals node has NO incoming
// exec (it is a source) — `runFlowEvent` walks FROM its per-event exec-out pin.
// ---------------------------------------------------------------------------

const SIGNALS: GameSignalsNode = { id: 'signals', kind: 'gameSignals', pos: { x: 0, y: 0 } };

const DOC: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			SIGNALS,
			{ id: 'showFs', kind: 'showContainer', pos: { x: 300, y: 0 }, ref: 'freespin' },
			{
				id: 'setTotal',
				kind: 'action',
				pos: { x: 600, y: 0 },
				ref: 'setFreeSpinCounterTotal',
				inputs: { total: { kind: 'wire' } },
			},
		],
		exec: [
			{ from: { node: 'signals', pin: 'freeSpinTrigger' }, to: { node: 'showFs', pin: 'exec' } },
			{ from: { node: 'showFs', pin: 'exec' }, to: { node: 'setTotal', pin: 'exec' } },
		],
		data: [
			{
				from: { node: 'signals', pin: 'freeSpinTrigger.totalFs' },
				to: { node: 'setTotal', pin: 'total' },
			},
		],
	},
	containers: [{ id: 'freespin', sceneId: 'freegame', z: 10 }],
};

// ---------------------------------------------------------------------------
// A recording FlowV2Env — each side effect appends a stable, comparable log entry.
// ---------------------------------------------------------------------------

type LogEntry = string;

const makeRecordingEnv = () => {
	const log: LogEntry[] = [];
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

const eqLog = (a: LogEntry[], b: LogEntry[]) => JSON.stringify(a) === JSON.stringify(b);

const execOutIds = (pins: Pin[]): string[] =>
	pins.filter((p) => p.dir === 'out' && p.kind === 'exec').map((p) => p.id);

const findDataOut = (pins: Pin[], id: string): Pin | undefined =>
	pins.find((p) => p.id === id && p.dir === 'out' && p.kind === 'data');

const main = async () => {
	console.log('Invisible Flow v2 — game-signals harness\n');

	const pinCtx: PinContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY };
	const pins = derivePins(SIGNALS, pinCtx);
	const outs = execOutIds(pins);

	// --- 1. derivation: book + lifecycle events surface; intents do NOT ---
	console.log('1. derivePins surfaces book + lifecycle events as exec-outs, excludes intents:');
	{
		assert(
			'has exec-out `freeSpinTrigger` (book)',
			outs.includes('freeSpinTrigger'),
			outs.join(','),
		);
		assert('has exec-out `reveal` (book)', outs.includes('reveal'));
		assert('has exec-out `load` (lifecycle)', outs.includes('load'));
		assert('does NOT have exec-out `spin` (intent)', !outs.includes('spin'), outs.join(','));
		assert('does NOT have exec-out `increase` (intent)', !outs.includes('increase'));
		assert(
			'has NO exec-in (it is a source/entry node)',
			!pins.some((p) => p.dir === 'in' && p.kind === 'exec'),
		);
	}

	// --- 1b. freeSpinTrigger contributes typed data-outs ---
	console.log('\n1b. freeSpinTrigger contributes typed data-outs (<eventName>.<field>):');
	{
		const totalFs = findDataOut(pins, 'freeSpinTrigger.totalFs');
		const positions = findDataOut(pins, 'freeSpinTrigger.positions');
		assert(
			'data-out `freeSpinTrigger.totalFs` typed int',
			totalFs?.dataType?.t === 'int',
			JSON.stringify(totalFs?.dataType),
		);
		assert(
			'data-out `freeSpinTrigger.positions` typed list<Position>',
			positions?.dataType?.t === 'list' &&
				positions.dataType.of.t === 'struct' &&
				positions.dataType.of.name === 'Position',
			JSON.stringify(positions?.dataType),
		);
	}

	// --- 2. runtime: firing freeSpinTrigger walks the chain; the action gets total:10 ---
	console.log(
		'\n2. runFlowEvent(freeSpinTrigger) walks the chain, payload resolves through the pin:',
	);
	{
		const { env, log } = makeRecordingEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		await runFlowEvent(DOC, ctx, 'freeSpinTrigger', { totalFs: 10, positions: [] });

		const expected: LogEntry[] = [
			'show freespin@10',
			`effect setFreeSpinCounterTotal(${JSON.stringify({ total: 10 })})`,
		];
		assert(
			'records `show freespin@10` then `effect setFreeSpinCounterTotal({total:10})`, in order',
			eqLog(log, expected),
			log.join(' | '),
		);
	}

	// --- 3. an unsurfaced / unknown event is a parity-safe no-op ---
	console.log('\n3. an unsurfaced (intent) or unknown event records nothing (parity-safe):');
	{
		{
			const { env, log } = makeRecordingEnv();
			const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
			await runFlowEvent(DOC, ctx, 'spin', {}); // intent → never a gameSignals pin
			assert('intent `spin` → zero recorded calls', log.length === 0, log.join(' | '));
		}
		{
			const { env, log } = makeRecordingEnv();
			const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
			await runFlowEvent(DOC, ctx, 'winInfo', { totalWin: 5, wins: [] }); // surfaced but unwired
			assert(
				'surfaced-but-unwired `winInfo` → zero recorded calls',
				log.length === 0,
				log.join(' | '),
			);
		}
		{
			const { env, log } = makeRecordingEnv();
			const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
			await runFlowEvent(DOC, ctx, 'notAnEvent', {}); // unknown event
			assert('unknown `notAnEvent` → zero recorded calls', log.length === 0, log.join(' | '));
		}
	}

	console.log(
		`\n${failed ? 'V2 GAME-SIGNALS HARNESS: FAILED' : 'V2 GAME-SIGNALS HARNESS: PASSED'}`,
	);
	process.exit(failed ? 1 : 0);
};

void main();
