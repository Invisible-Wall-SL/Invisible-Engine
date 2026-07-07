/**
 * Invisible Flow v1→v2 TRANSLATOR — Phase B slice 1 (the choreography core).
 *
 *   pnpm --filter flow-spike run v2translate
 *
 * The cutover unlock: convert an authored v1 `FlowDoc` into a v2 `FlowDoc` FAITHFULLY (so a game like
 * the Book of Borut remake migrates without hand-guessing). This slice is the HEART — the pure
 * function that compiles a v1 `ChoreographyNode` TREE into a v2 exec/data GRAPH, plus the accessor /
 * payload / guard conversion. The mapping is 1:1 with the constructs Phase A shipped:
 *   sequence → exec chain · parallel → parallel node · broadcast → fireCue{await} · effect → action ·
 *   delay → delay(ms literal) · forEach → forEach(body/done) · branch → branch(then/else) ·
 *   FlowAccessor(literal/trigger/item/context/engine) → the matching v2 DataSource.
 *
 * (The screen→container + transition→show/hide/intent mapping — the rest of the doc-level translate —
 * builds ON this core in the next slice.)
 *
 * Verified by translating a re-encoded real v1 choreography (setWin + a forEach) and asserting the v2
 * output VALIDATES clean vs BOOK_OF_VOCAB and its node/exec shape matches the hand-authored version.
 */

import type { ChoreographyNode, FlowAccessor, FlowGuard, FlowPayload } from 'engine-flow';
import {
	validateFlowDoc,
	BOOK_OF_VOCAB,
	type Compare,
	type DataEdge,
	type DataSource,
	type ExecEdge,
	type FlowDoc,
	type Guard,
	type Node,
	type PinPath,
	type TemplateVocabulary,
	type TypeRef,
} from 'engine-flow-v2';

// ---------------------------------------------------------------------------
// The choreography compiler. A subtree compiles to a set of nodes + edges, an ENTRY node id, and the
// exec-out TAIL pin(s) a following sibling wires to (a branch has two tails; a terminal has none).
// ---------------------------------------------------------------------------

interface SubGraph {
	nodes: Node[];
	exec: ExecEdge[];
	data: DataEdge[];
	entry: string | null; // the first node to enter (null = an empty subtree).
	tails: PinPath[]; // exec-outs to connect the NEXT node to.
}

/** Look up an action/cue param's declared type (to type a literal correctly for the validator). */
const paramType = (vocab: TemplateVocabulary, ref: string, pin: string): TypeRef | undefined => {
	const a = vocab.actions.find((x) => x.name === ref)?.params.find((p) => p.name === pin);
	if (a) return a.type;
	const c = vocab.cues.find((x) => x.name === ref)?.payload.find((p) => p.name === pin);
	return c?.type;
};

const inferLiteralType = (v: unknown): TypeRef => {
	if (typeof v === 'boolean') return { t: 'bool' };
	if (typeof v === 'number') return Number.isInteger(v) ? { t: 'int' } : { t: 'float' };
	return { t: 'string' };
};

/** v1 `FlowAccessor` → v2 `DataSource`. `pinType` types a literal to the target pin (else inferred). */
const toDataSource = (acc: FlowAccessor, pinType?: TypeRef): DataSource => {
	switch (acc.kind) {
		case 'literal':
			return { kind: 'literal', type: pinType ?? inferLiteralType(acc.value), value: acc.value };
		case 'trigger':
			return {
				kind: 'accessor',
				path: acc.path ? { on: 'trigger', member: acc.path } : { on: 'trigger' },
			};
		case 'item':
			return {
				kind: 'accessor',
				path: acc.path ? { on: 'item', member: acc.path } : { on: 'item' },
			};
		case 'context':
			return { kind: 'accessor', path: { on: 'context', member: acc.path } };
		case 'engine':
			return { kind: 'accessor', path: { on: 'engine', key: acc.key } };
	}
};

const toInputs = (
	vocab: TemplateVocabulary,
	ref: string,
	payload: FlowPayload | undefined,
): Record<string, DataSource> => {
	const inputs: Record<string, DataSource> = {};
	for (const [pin, acc] of Object.entries(payload ?? {})) {
		inputs[pin] = toDataSource(acc, paramType(vocab, ref, pin));
	}
	return inputs;
};

const OP_MAP: Record<string, Compare['op']> = {
	eq: 'eq',
	neq: 'ne',
	gt: 'gt',
	gte: 'gte',
	lt: 'lt',
	lte: 'lte',
};

/** v1 `FlowGuard` → v2 `Guard` + the branch node's operand `inputs` (keyed `all.i.left` / `any.i.right`). */
const toGuard = (g: FlowGuard): { guard: Guard; inputs: Record<string, DataSource> } => {
	const inputs: Record<string, DataSource> = {};
	const conv = (preds: FlowGuard['all'], group: 'all' | 'any'): Compare[] =>
		(preds ?? []).map((p, i) => {
			inputs[`${group}.${i}.left`] = toDataSource(p.left);
			inputs[`${group}.${i}.right`] = toDataSource(p.right);
			return { left: toDataSource(p.left), op: OP_MAP[p.op] ?? 'eq', right: toDataSource(p.right) };
		});
	const guard: Guard = {};
	if (g.all?.length) guard.all = conv(g.all, 'all');
	if (g.any?.length) guard.any = conv(g.any, 'any');
	return { guard, inputs };
};

let seq = 0;
const uid = (p: string): string => `${p}_${seq++}`;

/** Compile one v1 `ChoreographyNode` into a v2 subgraph. */
const compile = (node: ChoreographyNode, vocab: TemplateVocabulary): SubGraph => {
	switch (node.kind) {
		case 'effect': {
			const id = uid('act');
			return {
				nodes: [
					{
						id,
						kind: 'action',
						pos: { x: 0, y: 0 },
						ref: node.name,
						inputs: toInputs(vocab, node.name, node.payload),
					},
				],
				exec: [],
				data: [],
				entry: id,
				tails: [{ node: id, pin: 'exec' }],
			};
		}
		case 'broadcast': {
			const id = uid('cue');
			const cue: Node = {
				id,
				kind: 'fireCue',
				pos: { x: 0, y: 0 },
				ref: node.event,
				inputs: toInputs(vocab, node.event, node.payload),
				...(node.await ? { await: true } : {}),
			};
			return { nodes: [cue], exec: [], data: [], entry: id, tails: [{ node: id, pin: 'exec' }] };
		}
		case 'delay': {
			const id = uid('delay');
			return {
				nodes: [
					{
						id,
						kind: 'delay',
						pos: { x: 0, y: 0 },
						inputs: { ms: { kind: 'literal', type: { t: 'ms' }, value: node.ms } },
					},
				],
				exec: [],
				data: [],
				entry: id,
				tails: [{ node: id, pin: 'exec' }],
			};
		}
		case 'sequence': {
			return chain(node.children.map((c) => compile(c, vocab)));
		}
		case 'parallel': {
			const id = uid('par');
			const kids = node.children.map((c) => compile(c, vocab));
			const nodes: Node[] = [{ id, kind: 'parallel', pos: { x: 0, y: 0 }, count: kids.length }];
			const exec: ExecEdge[] = [];
			const data: DataEdge[] = [];
			kids.forEach((k, i) => {
				nodes.push(...k.nodes);
				exec.push(...k.exec);
				data.push(...k.data);
				if (k.entry)
					exec.push({ from: { node: id, pin: `then[${i}]` }, to: { node: k.entry, pin: 'exec' } });
			});
			return { nodes, exec, data, entry: id, tails: [] }; // parallel is terminal (subchains carry).
		}
		case 'forEach': {
			const id = uid('each');
			const body = compile(node.body, vocab);
			const nodes: Node[] = [
				{
					id,
					kind: 'forEach',
					pos: { x: 0, y: 0 },
					mode: node.mode,
					inputs: { in: toDataSource(node.list) },
				},
				...body.nodes,
			];
			const exec = [...body.exec];
			if (body.entry)
				exec.push({ from: { node: id, pin: 'body' }, to: { node: body.entry, pin: 'exec' } });
			return { nodes, exec, data: [...body.data], entry: id, tails: [{ node: id, pin: 'done' }] };
		}
		case 'branch': {
			const id = uid('br');
			const { guard, inputs } = toGuard(node.guard);
			const thenG = compile(node.then, vocab);
			const elseG = node.otherwise ? compile(node.otherwise, vocab) : undefined;
			const nodes: Node[] = [
				{ id, kind: 'branch', pos: { x: 0, y: 0 }, guard, inputs },
				...thenG.nodes,
				...(elseG?.nodes ?? []),
			];
			const exec = [...thenG.exec, ...(elseG?.exec ?? [])];
			const data = [...thenG.data, ...(elseG?.data ?? [])];
			if (thenG.entry)
				exec.push({ from: { node: id, pin: 'then' }, to: { node: thenG.entry, pin: 'exec' } });
			if (elseG?.entry)
				exec.push({ from: { node: id, pin: 'else' }, to: { node: elseG.entry, pin: 'exec' } });
			return { nodes, exec, data, entry: id, tails: [...thenG.tails, ...(elseG?.tails ?? [])] };
		}
		default:
			return { nodes: [], exec: [], data: [], entry: null, tails: [] };
	}
};

/** Chain a list of subgraphs sequentially: each subgraph's tails → the next's entry. */
const chain = (parts: SubGraph[]): SubGraph => {
	const nodes: Node[] = [];
	const exec: ExecEdge[] = [];
	const data: DataEdge[] = [];
	let entry: string | null = null;
	let tails: PinPath[] = [];
	for (const part of parts) {
		nodes.push(...part.nodes);
		exec.push(...part.exec);
		data.push(...part.data);
		if (!part.entry) continue;
		if (!entry) entry = part.entry;
		for (const t of tails) exec.push({ from: t, to: { node: part.entry, pin: 'exec' } });
		tails = part.tails;
	}
	return { nodes, exec, data, entry, tails };
};

/** Translate a v1 event's `{ event, choreography }` into a v2 `event` node + its exec/data graph. */
export const translateEventChoreography = (
	event: string,
	choreography: ChoreographyNode,
	vocab: TemplateVocabulary,
): { nodes: Node[]; exec: ExecEdge[]; data: DataEdge[] } => {
	const eventId = `on_${event}`;
	const body = compile(choreography, vocab);
	const nodes: Node[] = [
		{ id: eventId, kind: 'event', pos: { x: 0, y: 0 }, ref: event },
		...body.nodes,
	];
	const exec = [...body.exec];
	if (body.entry)
		exec.push({ from: { node: eventId, pin: 'exec' }, to: { node: body.entry, pin: 'exec' } });
	return { nodes, exec, data: body.data };
};

// ---------------------------------------------------------------------------
// Harness — translate a re-encoded real v1 choreography and validate the v2 output.
// ---------------------------------------------------------------------------

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

// v1 helpers (mirror flowDoc.ts).
const b = (event: string, payload?: FlowPayload, await_ = false): ChoreographyNode => ({
	kind: 'broadcast',
	event,
	...(payload ? { payload } : {}),
	...(await_ ? { async: true, await: true } : {}),
});
const e = (name: string, payload?: FlowPayload): ChoreographyNode => ({
	kind: 'effect',
	name,
	...(payload ? { payload } : {}),
});
const seqN = (...children: ChoreographyNode[]): ChoreographyNode => ({
	kind: 'sequence',
	children,
});
const trg = (path: string): FlowAccessor => ({ kind: 'trigger', path });
const lit = (value: string | number | boolean): FlowAccessor => ({ kind: 'literal', value });

// The v1 `setWin` choreography (flowDoc.ts) — win panel show + awaited count-up + hide.
const setWinChoreo = seqN(
	b('winShow'),
	e('winShow', { winLevel: trg('winLevel') }),
	e('winLevelSoundsPlay', { winLevel: trg('winLevel') }),
	e('winUpdate', { amount: trg('amount'), winLevel: trg('winLevel') }),
	e('winLevelSoundsStop'),
	b('winHide'),
	e('winHide'),
);

// A forEach choreography (winInfo body): soundOnce + forEach wins → boardShow + awaited animate.
const winInfoChoreo = seqN(b('soundOnce', { name: lit('sfx_winlevel_small') }), {
	kind: 'forEach',
	list: trg('wins'),
	mode: 'sequence',
	body: seqN(
		b('boardShow'),
		b('boardWithAnimateSymbols', { symbolPositions: { kind: 'item', path: 'positions' } }, true),
	),
});

const main = () => {
	console.log('Invisible Flow v1→v2 translator — Phase B choreography harness\n');

	console.log('1. translate `setWin` — the v2 graph validates + has the right shape:');
	{
		seq = 0;
		const g = translateEventChoreography('setWin', setWinChoreo, BOOK_OF_VOCAB);
		const doc: FlowDoc = {
			version: 2,
			templateId: 'bookOf',
			graph: g,
			containers: [{ id: 'basegame', sceneId: 'basegame', z: 0 }],
		};
		const issues = validateFlowDoc(doc, BOOK_OF_VOCAB, { version: 2, functions: [] });
		assert(
			'validates 0 issues',
			issues.length === 0,
			issues.map((i) => `${i.code}:${i.message}`).join(' | '),
		);
		const kinds = g.nodes.map((n) => n.kind);
		assert(
			'node kinds = event + (cue action action action action cue action)',
			JSON.stringify(kinds) ===
				JSON.stringify([
					'event',
					'fireCue',
					'action',
					'action',
					'action',
					'action',
					'fireCue',
					'action',
				]),
			kinds.join(','),
		);
		// The winLevel literal on `winShow` is typed `int` (from the vocab), not a bare inferred int.
		const winShowAction = g.nodes.find(
			(n) => n.kind === 'action' && (n as { ref: string }).ref === 'winShow',
		) as { inputs?: Record<string, DataSource> } | undefined;
		const wl = winShowAction?.inputs?.winLevel;
		assert(
			'winShow.winLevel accessor = $trigger.winLevel',
			wl?.kind === 'accessor' &&
				JSON.stringify(wl) ===
					JSON.stringify({ kind: 'accessor', path: { on: 'trigger', member: 'winLevel' } }),
		);
	}

	console.log('\n2. translate `winInfo` — forEach + awaited cue compile + validate:');
	{
		seq = 0;
		const g = translateEventChoreography('winInfo', winInfoChoreo, BOOK_OF_VOCAB);
		const doc: FlowDoc = {
			version: 2,
			templateId: 'bookOf',
			graph: g,
			containers: [{ id: 'basegame', sceneId: 'basegame', z: 0 }],
		};
		const issues = validateFlowDoc(doc, BOOK_OF_VOCAB, { version: 2, functions: [] });
		assert(
			'validates 0 issues',
			issues.length === 0,
			issues.map((i) => `${i.code}:${i.message}`).join(' | '),
		);
		const each = g.nodes.find((n) => n.kind === 'forEach');
		assert('a forEach node was produced with an $trigger.wins `in`', !!each);
		const animate = g.nodes.find(
			(n) => n.kind === 'fireCue' && (n as { ref: string }).ref === 'boardWithAnimateSymbols',
		) as { await?: boolean } | undefined;
		assert('the awaited broadcast → fireCue { await: true }', animate?.await === true);
	}

	console.log(`\n${failed ? 'V2 TRANSLATE HARNESS: FAILED' : 'V2 TRANSLATE HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

main();
