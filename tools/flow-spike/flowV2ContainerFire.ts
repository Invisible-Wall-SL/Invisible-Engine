/**
 * Invisible Flow v2 — CONTAINER-FIRE runtime harness (schema §10; decision #6/#8).
 *
 *   pnpm --filter flow-spike run v2containerfire
 *
 * Proves, HEADLESSLY, that a FUSED container-event pin (an exec-out on a `showContainer` node,
 * keyed `<componentId>.on<Event>`) actually FIRES its authored logic at runtime — the entry point
 * `runFlowContainerEvent`. The CRITICAL invariant: firing a container-event pin must NOT re-run the
 * `showContainer` node (that would re-mount the container); the interpreter walks FROM the pin's
 * wired target instead. Uses the REAL `book-of` vocabulary (`startSpin` command + `boardShow` cue).
 *
 *   showContainer(base)  ─spinButton.onSpin→  action startSpin  ─exec→  fireCue boardShow
 *
 * A recording `FlowV2Env` logs every effect / broadcast / show / hide call in order. Asserts:
 *   1. `runFlowContainerEvent(doc, ctx, 'spinButton', 'spin')` records `effect:startSpin` then
 *      `broadcast:boardShow` — and NO `show base` (the show node is not re-run).
 *   2. an unwired press (`ghost`/`nope`) records nothing (parity-safe fall-through).
 *   3. `flowOwnsContainerEvent(doc, 'spinButton', 'spin') === true`; `('ghost', 'nope') === false`.
 *
 * Prints PASS/FAIL per assertion + a final `V2 CONTAINER-FIRE HARNESS: PASSED`.
 */

import {
	BOOK_OF_VOCAB,
	flowOwnsContainerEvent,
	runFlowContainerEvent,
	type FlowDoc,
	type FlowV2Env,
	type FunctionLibraryDoc,
	type RunContext,
} from 'engine-flow-v2';

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

// A real book-of cue with no payload — the trailing presentation signal the spin fires.
const CUE = 'boardShow';

// ---------------------------------------------------------------------------
// The FlowDoc: a `showContainer(base)` node whose fused `spinButton.onSpin` exec-out wires into
// `startSpin` → `fireCue boardShow`. The show node has NO incoming exec here — we only fire the pin.
// ---------------------------------------------------------------------------

const DOC: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			{ id: 'showBase', kind: 'showContainer', pos: { x: 0, y: 0 }, ref: 'base' },
			{ id: 'doSpin', kind: 'action', pos: { x: 300, y: 0 }, ref: 'startSpin' },
			{ id: 'cue', kind: 'fireCue', pos: { x: 600, y: 0 }, ref: CUE },
		],
		exec: [
			{ from: { node: 'showBase', pin: 'spinButton.onSpin' }, to: { node: 'doSpin', pin: 'exec' } },
			{ from: { node: 'doSpin', pin: 'exec' }, to: { node: 'cue', pin: 'exec' } },
		],
		data: [],
	},
	containers: [{ id: 'base', sceneId: 'basegame', z: 0 }],
};

// ---------------------------------------------------------------------------
// A recording FlowV2Env — each side effect appends a stable, comparable log entry.
// ---------------------------------------------------------------------------

type LogEntry = string;

const makeRecordingEnv = () => {
	const log: LogEntry[] = [];
	const env: FlowV2Env = {
		async effect(name, payload) {
			const args = Object.values(payload);
			log.push(`effect ${name}(${args.map((v) => JSON.stringify(v)).join(',')})`);
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

const main = async () => {
	console.log('Invisible Flow v2 — container-fire runtime harness\n');

	// --- 1. a wired container-event pin fires its chain; the show node is NOT re-run ---
	console.log('1. firing spinButton.onSpin walks from the pin (no re-mount of the show node):');
	{
		const { env, log } = makeRecordingEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		await runFlowContainerEvent(DOC, ctx, 'spinButton', 'spin');

		const expected: LogEntry[] = ['effect startSpin()', `broadcast ${CUE}`];
		assert(
			'records effect:startSpin then broadcast:boardShow, in order',
			eqLog(log, expected),
			log.join(' | '),
		);
		assert(
			'records NO showContainer call (the show node is not re-run)',
			!log.some((e) => e.startsWith('show ')),
			log.join(' | '),
		);
	}

	// --- 2. an unwired press is a parity-safe no-op ---
	console.log('\n2. an unwired container-event press records nothing (parity-safe):');
	{
		const { env, log } = makeRecordingEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		await runFlowContainerEvent(DOC, ctx, 'ghost', 'nope');
		assert('no exec edge for ghost.onNope → zero recorded calls', log.length === 0, log.join(' | '));
	}

	// --- 3. the pure ownership predicate ---
	console.log('\n3. flowOwnsContainerEvent reflects the wired pins (no env needed):');
	{
		assert(
			'flowOwnsContainerEvent(spinButton, spin) === true',
			flowOwnsContainerEvent(DOC, 'spinButton', 'spin') === true,
		);
		assert(
			'flowOwnsContainerEvent(ghost, nope) === false',
			flowOwnsContainerEvent(DOC, 'ghost', 'nope') === false,
		);
	}

	console.log(
		`\n${failed ? 'V2 CONTAINER-FIRE HARNESS: FAILED' : 'V2 CONTAINER-FIRE HARNESS: PASSED'}`,
	);
	process.exit(failed ? 1 : 0);
};

void main();
