/**
 * Invisible Flow v2 — canonical book-of CHOREOGRAPHIES harness (package `engine-flow-v2/reference`).
 *
 *   pnpm --filter flow-spike run v2choreo
 *
 * Proves the template's shared presentation choreographies (`BOOK_OF_CHOREO` + `buildChoreo`) — the
 * SAME artifact `apps/lines` builds `LINES_FLOW_V2_DOC` from AND the v1→v2 translator injects — build
 * into a v2 graph that VALIDATES clean vs `BOOK_OF_VOCAB` and has the right shape (the full
 * `freeSpinTrigger` sequence, awaited cues carrying `await`, and the `winInfo` forEach lighting each
 * win's paying cells through the `animateWinSymbols` action — a69833fc replaced the raw
 * `boardWithAnimateSymbols` cue there, which lit the non-paying payline tail).
 */

import {
	buildChoreo,
	makeChoreoUid,
	validateFlowDoc,
	BOOK_OF_CHOREO,
	BOOK_OF_VOCAB,
	type DataEdge,
	type ExecEdge,
	type FlowDoc,
	type Node,
} from 'engine-flow-v2';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

// Build the whole reference doc EXACTLY as `apps/lines/flowV2Doc.ts` does (event node + subgraph per
// canonical choreography, one shared uid generator).
const nodes: Node[] = [];
const exec: ExecEdge[] = [];
const data: DataEdge[] = [];
const uid = makeChoreoUid();
for (const [event, steps] of Object.entries(BOOK_OF_CHOREO)) {
	const eventId = `on_${event}`;
	nodes.push({ id: eventId, kind: 'event', pos: { x: 0, y: 0 }, ref: event });
	const body = buildChoreo(steps, uid);
	nodes.push(...body.nodes);
	exec.push(...body.exec);
	data.push(...body.data);
	if (body.entry)
		exec.push({ from: { node: eventId, pin: 'exec' }, to: { node: body.entry, pin: 'exec' } });
}
const doc: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: { nodes, exec, data },
	containers: [{ id: 'basegame', sceneId: 'basegame', z: 0 }],
};

const main = () => {
	console.log('Invisible Flow v2 — canonical book-of choreographies harness\n');

	console.log('1. the whole reference doc validates clean vs BOOK_OF_VOCAB:');
	const issues = validateFlowDoc(doc, BOOK_OF_VOCAB, { version: 2, functions: [] });
	assert('0 issues', issues.length === 0, issues.map((i) => `${i.code}:${i.message}`).join(' | '));

	console.log('\n2. every canonical choreography is present as an owned event:');
	const events = new Set(
		nodes.filter((n) => n.kind === 'event').map((n) => (n as { ref: string }).ref),
	);
	for (const name of Object.keys(BOOK_OF_CHOREO))
		assert(`event '${name}' authored`, events.has(name));

	console.log('\n3. `freeSpinTrigger` carries the full sequence + awaited cues:');
	{
		const fst = buildChoreo(BOOK_OF_CHOREO.freeSpinTrigger, makeChoreoUid());
		assert(
			'22 step nodes',
			fst.nodes.length === BOOK_OF_CHOREO.freeSpinTrigger.length,
			`${fst.nodes.length} nodes for ${BOOK_OF_CHOREO.freeSpinTrigger.length} steps`,
		);
		const awaited = fst.nodes.filter(
			(n) => n.kind === 'fireCue' && (n as { await?: boolean }).await,
		).length;
		assert('has awaited cues (uiHide/transition/…)', awaited >= 4, `${awaited} awaited`);
	}

	console.log(
		'\n4. `winInfo` produces a forEach whose body awaits the paying symbols before hiding the line:',
	);
	{
		const wi = buildChoreo(BOOK_OF_CHOREO.winInfo, makeChoreoUid());
		const each = wi.nodes.find((n) => n.kind === 'forEach');
		assert('a forEach node exists', !!each);
		const next = (id: string, pin: string) =>
			wi.exec.find((e) => e.from.node === id && e.from.pin === pin)?.to.node;
		const bodyChain: string[] = [];
		for (let id = each && next(each.id, 'body'); id; id = next(id, 'exec')) {
			const node = wi.nodes.find((n) => n.id === id);
			bodyChain.push((node as { ref?: string } | undefined)?.ref ?? '?');
		}
		const animate = wi.nodes.find(
			(n) => n.kind === 'action' && (n as { ref?: string }).ref === 'animateWinSymbols',
		);
		assert(
			'the body lights the win via the `animateWinSymbols` ACTION (paying cells only), not the raw cue',
			!!animate && !bodyChain.includes('boardWithAnimateSymbols'),
			bodyChain.join(' → '),
		);
		assert(
			'`animateWinSymbols` runs before `hideWinLine` in the body chain (the action await gates the hide)',
			bodyChain.indexOf('animateWinSymbols') >= 0 &&
				bodyChain.indexOf('animateWinSymbols') < bodyChain.indexOf('hideWinLine'),
			bodyChain.join(' → '),
		);
		const inputs = (animate as { inputs?: Record<string, unknown> } | undefined)?.inputs ?? {};
		const readsItem = (pin: string, member: string) => {
			const v = inputs[pin] as { kind?: string; path?: { on?: string; member?: string } };
			return v?.kind === 'accessor' && v.path?.on === 'item' && v.path.member === member;
		};
		assert(
			"`animateWinSymbols` is fed the win item's `positions` + `kind`",
			readsItem('positions', 'positions') && readsItem('kind', 'kind'),
			JSON.stringify(inputs),
		);
	}

	console.log(`\n${failed ? 'V2 CHOREO HARNESS: FAILED' : 'V2 CHOREO HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

main();
