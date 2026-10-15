/**
 * A Branch guard on a `$trigger` field is typed by the event its chain starts on:
 *   pnpm --filter launcher-api check:flow-guard-types
 *
 * The bug: `meterUpdate → fillMeter → Branch($trigger.full eq 1)` never took `then`. The inspector
 * seeded the literal beside a `$trigger` read as `int`, and `eq` is strict `===` at runtime, so the
 * guard was `true === 1` — always false, with nothing in Validation saying why.
 *
 *  1. `triggerOwners` + `triggerFieldType`: a node's `$trigger` field type is read off the event
 *     whose chain reaches it — an `event` node or a `gameSignals` pin, through a group — and is
 *     `undefined` (today's `int` seed) when the chain cannot be resolved: an orphan, a
 *     container-event chain, an undeclared field, two events that disagree.
 *  2. `guardOperandType`: a literal, an `$engine` value and a `$trigger` field are typed; a wire is
 *     not.
 *  3. `guardLiteralMismatch` + the `guard-type-mismatch` warning: `full eq 1` is flagged at the
 *     literal's operand, `full eq true` and number-vs-number rows are not, nor is an ordering op;
 *     the warning adds no error, so Publish is unchanged.
 *  4. Runtime: the bool literal takes `then` on a full pot and `else` otherwise; the int literal
 *     takes `else` either way (the bug, pinned).
 *  5. The Svelte wiring this gate cannot mount, source-scanned: the inspector types the other side
 *     through `guardOperandType` with the Branch's owners, the bool editor saves a `bool` literal,
 *     the mismatch hint carries its fix, and the Validation panel knows the code.
 */
import { readFileSync } from 'node:fs';
import type {
	Compare,
	DataSource,
	FlowDoc,
	FlowV2Env,
	FunctionLibraryDoc,
	Graph,
	Node,
	RunContext,
	TemplateVocabulary,
} from 'engine-flow-v2';

const F = await import('../../../packages/engine-flow-v2/index.ts');

let failures = 0;
let passes = 0;
function eq(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes++;
		return;
	}
	failures++;
	console.error(`✗ ${name}\n    expected ${e}\n    got      ${a}`);
}
const source = (path: string): string =>
	readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// ---- fixtures ----------------------------------------------------------------------------------

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
const VOCAB: TemplateVocabulary = F.HOLD_AND_WIN_VOCAB;
const at = { x: 0, y: 0 };

const INT_ONE: DataSource = { kind: 'literal', type: { t: 'int' }, value: 1 };
const BOOL_TRUE: DataSource = { kind: 'literal', type: { t: 'bool' }, value: true };
const trig = (member: string): DataSource => ({
	kind: 'accessor',
	path: { on: 'trigger', member },
});
const row = (left: DataSource, right: DataSource, op: Compare['op'] = 'eq'): Compare => ({
	left,
	op,
	right,
});

/** `event(meterUpdate) → fillMeter → Branch(guard) → then: cue full / else: cue notFull` — the
 *  user's chain. */
const meterDoc = (guard: Compare[]): FlowDoc => ({
	version: 2,
	templateId: 'holdAndWin',
	containers: [],
	graph: {
		nodes: [
			{ id: 'onMeter', kind: 'event', pos: at, ref: 'meterUpdate' },
			{
				id: 'fill',
				kind: 'action',
				pos: at,
				ref: 'fillMeter',
				inputs: { bookEvent: { kind: 'accessor', path: { on: 'trigger' } } },
			},
			{ id: 'branch', kind: 'branch', pos: at, guard: { all: guard } },
			{ id: 'full', kind: 'fireCue', pos: at, ref: 'full' },
			{ id: 'notFull', kind: 'fireCue', pos: at, ref: 'notFull' },
		],
		exec: [
			{ from: { node: 'onMeter', pin: 'exec' }, to: { node: 'fill', pin: 'exec' } },
			{ from: { node: 'fill', pin: 'exec' }, to: { node: 'branch', pin: 'exec' } },
			{ from: { node: 'branch', pin: 'then' }, to: { node: 'full', pin: 'exec' } },
			{ from: { node: 'branch', pin: 'else' }, to: { node: 'notFull', pin: 'exec' } },
		],
		data: [],
	},
});

const ownersOf = (graph: Graph, nodeId: string): Set<string> | undefined =>
	F.triggerOwners(F.flattenGroups(graph)).get(nodeId);
const fullType = (graph: Graph, nodeId = 'branch', vocab = VOCAB) =>
	F.triggerFieldType(vocab, ownersOf(graph, nodeId), 'full');

// ---- 1. the chain's event types `$trigger.<field>` ----------------------------------------------
{
	const g = meterDoc([row(trig('full'), INT_ONE)]).graph;
	eq('event-node chain: owners are the event', [...(ownersOf(g, 'branch') ?? [])], ['meterUpdate']);
	eq('event-node chain: full is bool', fullType(g), { t: 'bool' });
	eq('event-node chain: level is int', F.triggerFieldType(VOCAB, ownersOf(g, 'branch'), 'level'), {
		t: 'int',
	});
	eq(
		'an undeclared field stays unknown',
		F.triggerFieldType(VOCAB, ownersOf(g, 'branch'), 'nope'),
		undefined,
	);

	// The same chain started from the `gameSignals` pin instead of an `event` node.
	const signals: Graph = {
		nodes: [{ id: 'signals', kind: 'gameSignals', pos: at }, ...g.nodes.slice(1)],
		exec: [
			{ from: { node: 'signals', pin: 'meterUpdate' }, to: { node: 'fill', pin: 'exec' } },
			...g.exec.slice(1),
		],
		data: [],
	};
	eq('gameSignals pin chain: full is bool', fullType(signals), { t: 'bool' });

	// The chain runs through a collapsed group — the walk sees it flattened.
	const grouped = F.collapseToGroup(
		{ doc: meterDoc([row(trig('full'), INT_ONE)]), selection: ['fill'], label: 'Fill' },
		{ vocab: VOCAB, library: LIBRARY },
	);
	if ('error' in grouped) throw new Error(grouped.error);
	eq(
		'the fill node is folded into a group',
		grouped.doc.graph.nodes.some((n) => n.id === 'fill'),
		false,
	);
	eq('through a group: full is bool', fullType(grouped.doc.graph), { t: 'bool' });

	// Unresolvable ⇒ undefined, so the inspector keeps its old `int` seed.
	const orphan: Graph = { ...g, exec: g.exec.filter((e) => e.from.node !== 'fill') };
	eq('an orphan chain is unknown', fullType(orphan), undefined);

	const containerChain: Graph = {
		nodes: [
			{ id: 'show', kind: 'showContainer', pos: at, ref: 'pots' },
			{ id: 'branch', kind: 'branch', pos: at, guard: { all: [] } },
		],
		exec: [{ from: { node: 'show', pin: 'potPanel.onTap' }, to: { node: 'branch', pin: 'exec' } }],
		data: [],
	};
	eq('a container-event chain is unknown', fullType(containerChain), undefined);

	// Two events reach the Branch: agreeing types resolve, disagreeing ones never guess.
	const twoEvents = (other: string): Graph => ({
		nodes: [
			{ id: 'a', kind: 'event', pos: at, ref: 'meterUpdate' },
			{ id: 'b', kind: 'event', pos: at, ref: other },
			{ id: 'branch', kind: 'branch', pos: at, guard: { all: [] } },
		],
		exec: [
			{ from: { node: 'a', pin: 'exec' }, to: { node: 'branch', pin: 'exec' } },
			{ from: { node: 'b', pin: 'exec' }, to: { node: 'branch', pin: 'exec' } },
		],
		data: [],
	});
	const odd: TemplateVocabulary = {
		...VOCAB,
		events: [
			...VOCAB.events,
			{ name: 'oddMeter', payload: [{ name: 'full', type: { t: 'int' } }] },
			{ name: 'twinMeter', payload: [{ name: 'full', type: { t: 'bool' } }] },
		],
	};
	eq('two events agreeing on full: bool', fullType(twoEvents('twinMeter'), 'branch', odd), {
		t: 'bool',
	});
	eq(
		'two events disagreeing on full: unknown',
		fullType(twoEvents('oddMeter'), 'branch', odd),
		undefined,
	);
	eq('an event without the field: unknown', fullType(twoEvents('luckySpin')), undefined);
}

// ---- 2. guardOperandType -----------------------------------------------------------------------
{
	const owners = new Set(['meterUpdate']);
	eq('a literal states its type', F.guardOperandType(VOCAB, INT_ONE, owners), { t: 'int' });
	eq('a $trigger field', F.guardOperandType(VOCAB, trig('full'), owners), { t: 'bool' });
	eq(
		'the whole $trigger is not a scalar',
		F.guardOperandType(VOCAB, { kind: 'accessor', path: { on: 'trigger' } }, owners),
		undefined,
	);
	eq(
		'a $trigger field off no chain',
		F.guardOperandType(VOCAB, trig('full'), undefined),
		undefined,
	);
	const engineBool = VOCAB.values.find((v) => v.type.t === 'bool');
	eq('the vocabulary declares a bool engine value', engineBool !== undefined, true);
	eq(
		'an $engine value',
		F.guardOperandType(
			VOCAB,
			{ kind: 'accessor', path: { on: 'engine', key: engineBool!.name } },
			undefined,
		),
		{ t: 'bool' },
	);
	eq('a wire is unknown', F.guardOperandType(VOCAB, { kind: 'wire' }, owners), undefined);
}

// ---- 3. the mismatch rule and its warning ------------------------------------------------------
{
	const owners = new Set(['meterUpdate']);
	const m = (r: Compare) => F.guardLiteralMismatch(VOCAB, r, owners);
	eq('full eq 1 is a mismatch at the literal', m(row(trig('full'), INT_ONE)), {
		literal: 'right',
		value: 1,
		read: { on: 'trigger', member: 'full' },
		type: { t: 'bool' },
	});
	eq('1 ne full: the literal on the left', m(row(INT_ONE, trig('full'), 'ne')), {
		literal: 'left',
		value: 1,
		read: { on: 'trigger', member: 'full' },
		type: { t: 'bool' },
	});
	eq('full eq true is clean', m(row(trig('full'), BOOL_TRUE)), undefined);
	eq('full gt 0 compares as numbers — clean', m(row(trig('full'), INT_ONE, 'gt')), undefined);
	eq('level eq 1 (number vs number) is clean', m(row(trig('level'), INT_ONE)), undefined);
	eq(
		"meter eq 'pot1' (string vs string) is clean",
		m(row(trig('meter'), { kind: 'literal', type: { t: 'string' }, value: 'pot1' })),
		undefined,
	);
	eq('meter eq 1 (string vs number) is a mismatch', m(row(trig('meter'), INT_ONE))?.type, {
		t: 'string',
	});
	eq(
		'an unknown read is never judged',
		F.guardLiteralMismatch(VOCAB, row(trig('full'), INT_ONE), undefined),
		undefined,
	);

	const validate = (doc: FlowDoc) => F.validateFlowDoc(doc, VOCAB, LIBRARY);
	const broken = validate(meterDoc([row(trig('full'), INT_ONE)]));
	const fixed = validate(meterDoc([row(trig('full'), BOOL_TRUE)]));
	const guardIssues = (issues: typeof broken) =>
		issues.filter((i) => i.code === 'guard-type-mismatch');
	eq(
		'full eq 1 raises one warning at the literal operand',
		guardIssues(broken).map((i) => [i.severity, i.at]),
		[['warning', { on: 'pin', node: 'branch', pin: 'all.0.right' }]],
	);
	eq(
		'the warning names the read, its type and the fix',
		['$trigger.full is bool', 'always false', 'on / off'].map((s) =>
			guardIssues(broken)[0]?.message.includes(s),
		),
		[true, true, true],
	);
	eq('full eq true is clean in Validation', guardIssues(fixed), []);
	const errors = (issues: typeof broken) =>
		issues.filter((i) => i.severity === 'error').map((i) => i.code);
	eq('the warning adds no error (Publish is unchanged)', errors(broken), errors(fixed));

	// `any` rows are judged too.
	const anyDoc = meterDoc([]);
	const branch = anyDoc.graph.nodes.find((n) => n.id === 'branch') as Node & { kind: 'branch' };
	branch.guard = { any: [row(trig('full'), INT_ONE, 'ne')] };
	eq(
		'an any row is judged, and ne reads always true',
		guardIssues(validate(anyDoc)).map((i) => [i.at, i.message.includes('always true')]),
		[[{ on: 'pin', node: 'branch', pin: 'any.0.right' }, true]],
	);

	const engineKey = VOCAB.values.find((v) => v.type.t === 'bool')!.name;
	const engineDoc = meterDoc([
		row({ kind: 'accessor', path: { on: 'engine', key: engineKey } }, INT_ONE),
	]);
	eq(
		'an $engine read is named in its warning',
		guardIssues(validate(engineDoc)).map((i) => i.message.includes(`$engine.${engineKey} is bool`)),
		[true],
	);
}

// ---- 4. runtime: the bool literal takes `then` on a full pot -----------------------------------
{
	const run = async (doc: FlowDoc, full: boolean): Promise<string[]> => {
		const cues: string[] = [];
		const env: FlowV2Env = {
			async effect() {},
			async broadcast(cue) {
				cues.push(cue);
			},
			async waitForTimeout() {},
			timeScale: () => 1,
			showContainer() {},
			hideContainer() {},
			engineRead: () => undefined,
		};
		const ctx: RunContext = { vocab: VOCAB, library: LIBRARY, env };
		await F.runFlowEvent(doc, ctx, 'meterUpdate', { meter: 'pot1', level: 5, max: 5, full });
		return cues;
	};
	const fixed = meterDoc([row(trig('full'), BOOL_TRUE)]);
	const broken = meterDoc([row(trig('full'), INT_ONE)]);
	eq('full eq true on a full pot takes then', await run(fixed, true), ['full']);
	eq('full eq true on a pot not full takes else', await run(fixed, false), ['notFull']);
	eq('full eq 1 on a full pot takes else (the bug)', await run(broken, true), ['notFull']);
}

// ---- 5. the Svelte wiring, source-scanned ------------------------------------------------------
{
	const inspector = source('src/routes/(app)/flow-v2/NodeInspector.svelte');
	eq(
		'the inspector types a guard side from the Branch chain',
		[
			"node.kind === 'branch' ? triggerOwners(flattenGroups(doc.graph)).get(node.id) : undefined",
			'return guardOperandType(vocab, other, branchOwners);',
			'const want = guardSideType(row[side]);',
			"return { kind: 'literal', type: t, value: false };",
			"commit({ kind: 'literal', type: lt, value: e.currentTarget.value === 'true' })",
			'{@const bad = guardLiteralMismatch(vocab, row, branchOwners)}',
			'setGuardSide(i, bad.literal, retypedLiteral(row[bad.literal], bad.type))',
			"if (type.t === 'bool' && lit.kind === 'literal' && typeof lit.value === 'number')",
		].map((l) => inspector.includes(l)),
		[true, true, true, true, true, true, true, true],
	);
	eq(
		'the Validation panel has an icon for the code',
		source('src/routes/(app)/flow-v2/ValidationPanelV2.svelte').includes(
			"'guard-type-mismatch': '≠',",
		),
		true,
	);
}

if (failures > 0) {
	console.error(`\nflow guard types: ${failures} failed, ${passes} passed`);
	process.exit(1);
}
console.log(`flow guard types: all ${passes} checks passed`);
