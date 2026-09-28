/**
 * Invisible Flow v2 — EXEC FAN-OUT harness (`exec-out-fanout`).
 *
 *   pnpm --filter flow-spike run v2execfanout
 *
 * The interpreter follows ONE wire out of an exec-out (`nextExec` → `graph.exec.find`), so a second
 * wire from the same pin never runs. The editor now replaces the old wire when a new one is drawn,
 * and the validator flags a doc that already carries two — a hard error, because the publish gate
 * refuses on errors.
 *
 * Asserted here:
 *   1. the RUNTIME really drops the second wire — the node behind it never runs;
 *   2. `exec-out-fanout` (ERROR) fires on exactly that doc, located on the fanned pin;
 *   3. a straight chain (the same steps in series) is clean;
 *   4. the same rule holds inside a function body (`validateFunctionDef` shares the graph checks);
 *   5. `exec-in-fanin` is located on the right node and pin (its key used to have no separator, so
 *      the location it reported was the first two CHARACTERS of the key).
 */

import {
	createContainerMountModel,
	createFlowV2Env,
	runFlowEvent,
	validateFlowDoc,
	validateFunctionDef,
	type FlowDoc,
	type FlowIssue,
	type FunctionDef,
	type FunctionLibraryDoc,
	type RunContext,
	type TemplateVocabulary,
} from 'engine-flow-v2';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};
const codes = (issues: FlowIssue[]): string =>
	issues.map((i) => `${i.code}:${i.severity}`).join(' | ') || '(none)';

const EMPTY_LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
const VOCAB: TemplateVocabulary = {
	templateId: 'book-of',
	structs: [],
	enums: [],
	events: [{ name: 'go', payload: [] }],
	actions: [
		{ name: 'first', params: [], category: 'effect' },
		{ name: 'second', params: [], category: 'effect' },
	],
	cues: [],
	collections: [],
};

const NODES: FlowDoc['graph']['nodes'] = [
	{ id: 'onGo', kind: 'event', pos: { x: 0, y: 0 }, ref: 'go' },
	{ id: 'a', kind: 'action', pos: { x: 200, y: 0 }, ref: 'first' },
	{ id: 'b', kind: 'action', pos: { x: 200, y: 100 }, ref: 'second' },
];
const doc = (exec: FlowDoc['graph']['exec']): FlowDoc => ({
	version: 2,
	templateId: 'book-of',
	graph: { nodes: NODES, exec, data: [] },
	containers: [],
});

/** onGo.exec → a AND onGo.exec → b: two wires out of one exec-out. */
const FANNED = doc([
	{ from: { node: 'onGo', pin: 'exec' }, to: { node: 'a', pin: 'exec' } },
	{ from: { node: 'onGo', pin: 'exec' }, to: { node: 'b', pin: 'exec' } },
]);
/** onGo → a → b: the same two steps in series. */
const SERIES = doc([
	{ from: { node: 'onGo', pin: 'exec' }, to: { node: 'a', pin: 'exec' } },
	{ from: { node: 'a', pin: 'exec' }, to: { node: 'b', pin: 'exec' } },
]);
/** onGo → a and b → a: two wires INTO a's exec-in. */
const FANNED_IN = doc([
	{ from: { node: 'onGo', pin: 'exec' }, to: { node: 'a', pin: 'exec' } },
	{ from: { node: 'b', pin: 'exec' }, to: { node: 'a', pin: 'exec' } },
]);

const run = async (d: FlowDoc): Promise<string[]> => {
	const ran: string[] = [];
	const env = createFlowV2Env({
		mount: createContainerMountModel([]),
		effect: (name) => () => void ran.push(name),
		broadcast: () => {},
		waitForTimeout: () => Promise.resolve(),
		timeScale: () => 1,
		engineRead: () => undefined,
	});
	const ctx: RunContext = { vocab: VOCAB, library: EMPTY_LIBRARY, env };
	await runFlowEvent(d, ctx, 'go', {});
	return ran;
};

const main = async () => {
	console.log('Invisible Flow v2 — exec fan-out\n');

	const ranFanned = await run(FANNED);
	assert(
		'1. runtime: only the first wire out of a fanned exec-out runs',
		ranFanned.join(',') === 'first',
		ranFanned.join(','),
	);
	assert(
		'1. runtime: the same steps in series both run',
		(await run(SERIES)).join(',') === 'first,second',
	);

	const fanned = validateFlowDoc(FANNED, VOCAB, EMPTY_LIBRARY);
	const fanout = fanned.filter((i) => i.code === 'exec-out-fanout');
	assert('2. exec-out-fanout fires once on the fanned doc', fanout.length === 1, codes(fanned));
	assert('2. …as an error', fanout[0]?.severity === 'error');
	assert(
		'2. …located on the fanned pin',
		fanout[0]?.at.on === 'pin' && fanout[0].at.node === 'onGo' && fanout[0].at.pin === 'exec',
		JSON.stringify(fanout[0]?.at),
	);
	assert(
		'3. a series chain is clean',
		validateFlowDoc(SERIES, VOCAB, EMPTY_LIBRARY).length === 0,
		codes(validateFlowDoc(SERIES, VOCAB, EMPTY_LIBRARY)),
	);

	const fn: FunctionDef = {
		id: 'fn_two',
		name: 'Two',
		requires: {},
		inputs: [{ id: 'exec', dir: 'in', kind: 'exec' }],
		outputs: [{ id: 'exec', dir: 'out', kind: 'exec' }],
		body: {
			nodes: [
				{ id: 'fnEntry', kind: 'functionEntry', pos: { x: 0, y: 0 }, ref: 'fn_two' },
				{ id: 'x', kind: 'action', pos: { x: 200, y: 0 }, ref: 'first' },
				{ id: 'y', kind: 'action', pos: { x: 200, y: 100 }, ref: 'second' },
				{ id: 'fnResult', kind: 'functionResult', pos: { x: 400, y: 0 }, ref: 'fn_two' },
			],
			exec: [
				{ from: { node: 'fnEntry', pin: 'exec' }, to: { node: 'x', pin: 'exec' } },
				{ from: { node: 'fnEntry', pin: 'exec' }, to: { node: 'y', pin: 'exec' } },
				{ from: { node: 'x', pin: 'exec' }, to: { node: 'fnResult', pin: 'exec' } },
			],
			data: [],
		},
	};
	const fnIssues = validateFunctionDef(fn, VOCAB, { version: 2, functions: [fn] });
	assert(
		'4. a function body with a fanned exec-out is flagged too',
		fnIssues.some(
			(i) => i.code === 'exec-out-fanout' && i.at.on === 'pin' && i.at.node === 'fnEntry',
		),
		codes(fnIssues),
	);

	const fanin = validateFlowDoc(FANNED_IN, VOCAB, EMPTY_LIBRARY).find(
		(i) => i.code === 'exec-in-fanin',
	);
	assert(
		'5. exec-in-fanin is located on the real node + pin',
		fanin?.at.on === 'pin' && fanin.at.node === 'a' && fanin.at.pin === 'exec',
		JSON.stringify(fanin?.at),
	);

	console.log(failed ? '\nFAILED' : '\nALL PASS');
	if (failed) process.exitCode = 1;
};

void main();
