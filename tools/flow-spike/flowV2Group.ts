/**
 * Invisible Flow v2 — "Collapse to Group" harness (schema §5.2; the INLINE collapsed subgraph).
 *
 *   pnpm --filter flow-spike run v2group
 *
 * Proves, HEADLESSLY, the pure "Collapse to Group" transform against the REAL `engine-flow-v2`
 * `collapseToGroup` / `expandGroup` / `flattenGroups` + `derivePins` + `validateFlowDoc` +
 * `runFlowEvent` — no editor, no UI.
 *
 * A group is a PURE FOLDING of a node selection into ONE node, semantically identical to its
 * expanded form. Unlike `collapseToFunction` (which MERGES exec crossings onto one canonical exec
 * pin → fan-in), a group keeps EACH boundary crossing as its OWN pin. The four proofs:
 *
 *  1. FAN-IN-FREE grouping: two `event` nodes (`spin`, `increase`) each → its own `action`
 *     (`startSpin`, `increaseBet`); select the two actions; collapse into a group. The group node
 *     gets TWO distinct INPUT exec pins (one per action, NO merge) with descriptive labels, and
 *     `validateFlowDoc` reports ZERO issues (proving no fan-in).
 *  2. EXPAND is the inverse: `expandGroup` yields a graph equal to the pre-collapse graph (same
 *     nodes + edges, ignoring order/pos).
 *  3. RUNTIME equivalence: `runFlowEvent('spin', …)` against BOTH the collapsed + expanded docs
 *     records identical output (the group is transparent at runtime).
 *  4. NESTED + DATA: a group whose body has a data crossing (a data-in boundary pin) resolves the
 *     value through the boundary at runtime.
 *
 * Prints PASS/FAIL per assertion + a final `V2 GROUP HARNESS: PASSED`.
 */

import {
	BOOK_OF_VOCAB,
	collapseToGroup,
	derivePins,
	expandGroup,
	flattenGroups,
	runFlowEvent,
	validateFlowDoc,
	type FlowDoc,
	type FlowV2Env,
	type FunctionLibraryDoc,
	type Graph,
	type GroupNode,
	type Pin,
	type PinContext,
	type RunContext,
} from 'engine-flow-v2';

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
const ctx: PinContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY };

// ---------------------------------------------------------------------------
// 1. The source FlowDoc: two independent intent → action chains.
//    event spin     ─exec→ action startSpin
//    event increase ─exec→ action increaseBet
//    Selecting {startSpin, increaseBet} yields TWO exec crossIns from two distinct events → the
//    group MUST expose two distinct input exec pins (no merge / fan-in).
// ---------------------------------------------------------------------------

const sourceDoc = (): FlowDoc => ({
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			{ id: 'onSpin', kind: 'event', pos: { x: 0, y: 0 }, ref: 'spin' },
			{ id: 'onIncrease', kind: 'event', pos: { x: 0, y: 200 }, ref: 'increase' },
			{ id: 'startSpin', kind: 'action', pos: { x: 300, y: 0 }, ref: 'startSpin' },
			{ id: 'increaseBet', kind: 'action', pos: { x: 300, y: 200 }, ref: 'increaseBet' },
		],
		exec: [
			{ from: { node: 'onSpin', pin: 'exec' }, to: { node: 'startSpin', pin: 'exec' } },
			{ from: { node: 'onIncrease', pin: 'exec' }, to: { node: 'increaseBet', pin: 'exec' } },
		],
		data: [],
	},
	containers: [{ id: 'base', sceneId: 'basegame', z: 0 }],
});

// ---------------------------------------------------------------------------
// 4. A DATA-crossing source doc: a `freeSpinTrigger` event's `totalFs` data-out feeds an action
//    inside the selection. Selecting the action makes a data-in boundary pin on the group.
//    gameSignals... — simpler: use an `event freeSpinTrigger` → action setFreeSpinCounterTotal(total),
//    with the event's exec into the action too. Select {setTotal}; the crossings are:
//      crossIn exec : freeSpinTrigger.exec → setTotal.exec  → input exec pin
//      crossIn data : freeSpinTrigger.totalFs → setTotal.total → input data pin (typed int)
// ---------------------------------------------------------------------------

const dataSourceDoc = (): FlowDoc => ({
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			{ id: 'onFs', kind: 'event', pos: { x: 0, y: 0 }, ref: 'freeSpinTrigger' },
			{
				id: 'setTotal',
				kind: 'action',
				pos: { x: 300, y: 0 },
				ref: 'setFreeSpinCounterTotal',
				inputs: { total: { kind: 'wire' } },
			},
		],
		exec: [{ from: { node: 'onFs', pin: 'exec' }, to: { node: 'setTotal', pin: 'exec' } }],
		data: [
			{ from: { node: 'onFs', pin: 'totalFs' }, to: { node: 'setTotal', pin: 'total' } },
		],
	},
	containers: [{ id: 'freespin', sceneId: 'freegame', z: 10 }],
});

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
// Assertions + graph-equality helpers.
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
const issueList = (issues: { code: string; message: string }[]) =>
	issues.map((i) => `${i.code}:${i.message}`).join(' | ');

/** Node ids + kinds + refs, sorted (order/pos-independent). */
const nodeSignature = (g: Graph): string =>
	g.nodes
		.map((n) => `${n.id}:${n.kind}:${'ref' in n ? String(n.ref) : ''}`)
		.sort()
		.join(',');

/** The set of edges as sorted "from→to" strings, order-independent. */
const edgeSignature = (edges: { from: { node: string; pin: string }; to: { node: string; pin: string } }[]): string =>
	edges
		.map((e) => `${e.from.node}.${e.from.pin}->${e.to.node}.${e.to.pin}`)
		.sort()
		.join(',');

const graphEqual = (a: Graph, b: Graph): boolean =>
	nodeSignature(a) === nodeSignature(b) &&
	edgeSignature(a.exec) === edgeSignature(b.exec) &&
	edgeSignature(a.data) === edgeSignature(b.data);

const execInPins = (pins: Pin[]): Pin[] => pins.filter((p) => p.dir === 'in' && p.kind === 'exec');

const main = async () => {
	console.log('Invisible Flow v2 — collapse-to-group harness\n');

	// --- 1. fan-in-free grouping ---
	console.log('1. collapseToGroup keeps each crossing as its OWN pin (no exec-in fan-in):');
	const src = sourceDoc();
	const outcome = collapseToGroup(
		{ doc: src, selection: ['startSpin', 'increaseBet'], label: 'Button actions' },
		ctx,
	);
	if ('error' in outcome) {
		console.error(`  FAIL  collapseToGroup returned an error: ${outcome.error}`);
		console.log('\nV2 GROUP HARNESS: FAILED');
		process.exit(1);
	}
	const collapsed = outcome.doc;
	const groupNode = collapsed.graph.nodes.find((n) => n.kind === 'group') as GroupNode | undefined;

	assert('a `group` node replaced the selection', !!groupNode);
	assert(
		'the selected actions were removed from the main graph',
		!['startSpin', 'increaseBet'].some((id) => collapsed.graph.nodes.some((n) => n.id === id)),
	);
	assert(
		"the group's body holds the 2 selected nodes",
		!!groupNode &&
			['startSpin', 'increaseBet'].every((id) => groupNode.body.nodes.some((n) => n.id === id)),
	);

	const groupPins = groupNode ? derivePins(groupNode, ctx) : [];
	const inExecs = execInPins(groupPins);
	assert(
		'the group has TWO distinct INPUT exec pins (one per action, NO merge)',
		inExecs.length === 2,
		`got ${inExecs.length}: ${inExecs.map((p) => p.id).join(',')}`,
	);
	assert(
		'the two input pins are distinct (unique ids)',
		inExecs.length === 2 && inExecs[0].id !== inExecs[1].id,
	);
	assert(
		'the input pins carry descriptive labels (the inner action names)',
		inExecs.some((p) => p.label === 'startSpin') && inExecs.some((p) => p.label === 'increaseBet'),
		inExecs.map((p) => p.label).join(','),
	);

	// each event now feeds its OWN group input pin (both crossings preserved separately).
	const gid = groupNode?.id;
	assert(
		'onSpin.exec now feeds one group input pin',
		collapsed.graph.exec.some((e) => e.from.node === 'onSpin' && e.to.node === gid),
	);
	assert(
		'onIncrease.exec now feeds ANOTHER (distinct) group input pin',
		(() => {
			const a = collapsed.graph.exec.find((e) => e.from.node === 'onSpin' && e.to.node === gid);
			const b = collapsed.graph.exec.find(
				(e) => e.from.node === 'onIncrease' && e.to.node === gid,
			);
			return !!a && !!b && a.to.pin !== b.to.pin;
		})(),
	);

	{
		const issues = validateFlowDoc(collapsed, BOOK_OF_VOCAB, LIBRARY);
		assert(
			'validateFlowDoc(collapsed) reports ZERO issues (no fan-in)',
			issues.length === 0,
			issueList(issues),
		);
	}

	// --- 2. expand is the inverse ---
	console.log('\n2. expandGroup is the exact inverse (graph-semantic identity):');
	const expandOut = expandGroup(collapsed, gid!);
	if ('error' in expandOut) {
		console.error(`  FAIL  expandGroup returned an error: ${expandOut.error}`);
		console.log('\nV2 GROUP HARNESS: FAILED');
		process.exit(1);
	}
	const expanded = expandOut.doc;
	assert(
		'the expanded graph equals the pre-collapse graph (nodes + exec + data, order-independent)',
		graphEqual(expanded.graph, sourceDoc().graph),
		`nodes[${nodeSignature(expanded.graph)}] exec[${edgeSignature(expanded.graph.exec)}]`,
	);
	assert(
		'no `group` node remains after expand',
		!expanded.graph.nodes.some((n) => n.kind === 'group'),
	);

	// --- 3. runtime equivalence: collapsed vs expanded record identically ---
	console.log('\n3. runtime equivalence — the group is transparent at runtime:');
	{
		const run = async (doc: FlowDoc, eventName: string) => {
			const { env, log } = makeRecordingEnv();
			const rc: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
			await runFlowEvent(doc, rc, eventName, {});
			return log;
		};
		const spinCollapsed = await run(collapsed, 'spin');
		const spinExpanded = await run(expanded, 'spin');
		const spinRaw = await run(sourceDoc(), 'spin');
		assert(
			'runFlowEvent(spin) records identically for collapsed / expanded / raw',
			eqLog(spinCollapsed, spinExpanded) && eqLog(spinExpanded, spinRaw),
			`collapsed[${spinCollapsed.join('|')}] raw[${spinRaw.join('|')}]`,
		);
		assert(
			'the recorded spin effect is `startSpin` (not `increaseBet` — no crossed wiring)',
			spinCollapsed.length === 1 && spinCollapsed[0].startsWith('effect startSpin'),
			spinCollapsed.join('|'),
		);

		const incCollapsed = await run(collapsed, 'increase');
		assert(
			'runFlowEvent(increase) on the collapsed doc records `increaseBet` (the OTHER pin works too)',
			incCollapsed.length === 1 && incCollapsed[0].startsWith('effect increaseBet'),
			incCollapsed.join('|'),
		);
	}

	// --- 4. a data-crossing group resolves the value through the boundary pin ---
	console.log('\n4. a group with a DATA crossing resolves the value through its boundary pin:');
	{
		const dataSrc = dataSourceDoc();
		const dOut = collapseToGroup({ doc: dataSrc, selection: ['setTotal'], label: 'Set total' }, ctx);
		if ('error' in dOut) {
			console.error(`  FAIL  collapseToGroup(data) returned an error: ${dOut.error}`);
			console.log('\nV2 GROUP HARNESS: FAILED');
			process.exit(1);
		}
		const dCollapsed = dOut.doc;
		const dGroup = dCollapsed.graph.nodes.find((n) => n.kind === 'group') as GroupNode;
		const dPins = derivePins(dGroup, ctx);
		const dataIn = dPins.find((p) => p.dir === 'in' && p.kind === 'data');
		assert(
			'the group exposes a typed data-in boundary pin (int, from freeSpinTrigger.totalFs)',
			dataIn?.dataType?.t === 'int',
			JSON.stringify(dataIn?.dataType),
		);
		assert(
			'validateFlowDoc(dataCollapsed) reports ZERO issues',
			validateFlowDoc(dCollapsed, BOOK_OF_VOCAB, LIBRARY).length === 0,
			issueList(validateFlowDoc(dCollapsed, BOOK_OF_VOCAB, LIBRARY)),
		);

		const { env, log } = makeRecordingEnv();
		const rc: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		await runFlowEvent(dCollapsed, rc, 'freeSpinTrigger', { totalFs: 7, positions: [] });
		assert(
			'the action inside the group receives total:7 (value resolved THROUGH the boundary)',
			eqLog(log, [`effect setFreeSpinCounterTotal(${JSON.stringify({ total: 7 })})`]),
			log.join('|'),
		);
	}

	// --- 5. purity + rejected selections ---
	console.log('\n5. purity + guards:');
	{
		const before = JSON.stringify(src);
		collapseToGroup({ doc: src, selection: ['startSpin'], label: 'X' }, ctx);
		assert('the input doc was not mutated', JSON.stringify(src) === before);

		const bad = collapseToGroup(
			{ doc: sourceDoc(), selection: ['onSpin', 'startSpin'], label: 'Bad' },
			ctx,
		);
		assert('a selection containing an `event` entry point returns {error}', 'error' in bad);

		const empty = collapseToGroup({ doc: sourceDoc(), selection: [], label: 'E' }, ctx);
		assert('an empty selection returns {error}', 'error' in empty);

		const missing = collapseToGroup({ doc: sourceDoc(), selection: ['nope'], label: 'M' }, ctx);
		assert('a selection id not in the graph returns {error}', 'error' in missing);
	}

	// --- 6. flatten is COLLISION-SAFE: a body node id that also exists in the main graph must NOT
	// cross-wire (the "press Spin → shows the free-spin intro" bug). A group body keeps its ids, but the
	// editor's id minter doesn't reserve ids buried in a body, so a later main node can reuse one. Flatten
	// must re-namespace the colliding body id — else the two nodes collapse by id and the grouped node
	// inherits the main node's outgoing exec edge. ---
	console.log('\n6. flattenGroups re-namespaces a body id that collides with a main-graph node:');
	{
		// Group "Button actions" whose body node is id `shared` = startSpin.
		const base: FlowDoc = {
			version: 2,
			templateId: 'bookOf',
			graph: {
				nodes: [
					{ id: 'onSpin', kind: 'event', pos: { x: 0, y: 0 }, ref: 'spin' },
					{ id: 'shared', kind: 'action', pos: { x: 300, y: 0 }, ref: 'startSpin' },
				],
				exec: [{ from: { node: 'onSpin', pin: 'exec' }, to: { node: 'shared', pin: 'exec' } }],
				data: [],
			},
			containers: [{ id: 'freespin', sceneId: 'freegame', z: 10 }],
		};
		const gOut = collapseToGroup({ doc: base, selection: ['shared'], label: 'Button actions' }, ctx);
		if ('error' in gOut) {
			console.error(`  FAIL  collapseToGroup returned an error: ${gOut.error}`);
			console.log('\nV2 GROUP HARNESS: FAILED');
			process.exit(1);
		}
		// Now inject a SECOND, unrelated main-graph node that REUSES the id `shared`
		// (= setFreeSpinCounterTotal) whose exec-out shows the free-spin intro — the collision.
		const collided: FlowDoc = {
			...gOut.doc,
			graph: {
				nodes: [
					...gOut.doc.graph.nodes,
					{ id: 'onFs', kind: 'event', pos: { x: 0, y: 400 }, ref: 'freeSpinTrigger' },
					{ id: 'shared', kind: 'action', pos: { x: 300, y: 400 }, ref: 'setFreeSpinCounterTotal' },
					{ id: 'introShow', kind: 'showContainer', pos: { x: 600, y: 400 }, ref: 'freegame' },
				],
				exec: [
					...gOut.doc.graph.exec,
					{ from: { node: 'onFs', pin: 'exec' }, to: { node: 'shared', pin: 'exec' } },
					{ from: { node: 'shared', pin: 'exec' }, to: { node: 'introShow', pin: 'exec' } },
				],
				data: gOut.doc.graph.data,
			},
		};

		const flat = flattenGroups(collided.graph);
		const ids = flat.nodes.map((n) => n.id);
		assert(
			'the flattened graph has NO duplicate node ids',
			new Set(ids).size === ids.length,
			`dups: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(',')}`,
		);

		// press Spin: must record ONLY startSpin — it must NOT inherit `shared`'s show-intro edge.
		const spinLog = await (async () => {
			const { env, log } = makeRecordingEnv();
			const rc: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
			await runFlowEvent(collided, rc, 'spin', {});
			return log;
		})();
		assert(
			'runFlowEvent(spin) records ONLY startSpin (no cross-wired show)',
			spinLog.length === 1 && spinLog[0].startsWith('effect startSpin'),
			spinLog.join('|'),
		);

		// freeSpinTrigger: must run setFreeSpinCounterTotal → show, and must NOT run startSpin.
		const fsLog = await (async () => {
			const { env, log } = makeRecordingEnv();
			const rc: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
			await runFlowEvent(collided, rc, 'freeSpinTrigger', { totalFs: 7, positions: [] });
			return log;
		})();
		assert(
			'runFlowEvent(freeSpinTrigger) runs setFreeSpinCounterTotal then show — not startSpin',
			fsLog.some((l) => l.startsWith('effect setFreeSpinCounterTotal')) &&
				fsLog.some((l) => l.startsWith('show ')) &&
				!fsLog.some((l) => l.startsWith('effect startSpin')),
			fsLog.join('|'),
		);
	}

	console.log(`\n${failed ? 'V2 GROUP HARNESS: FAILED' : 'V2 GROUP HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
