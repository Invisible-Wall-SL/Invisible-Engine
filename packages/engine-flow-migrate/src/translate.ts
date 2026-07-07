/**
 * Invisible Flow v1 → v2 TRANSLATOR (the real home; prototyped in `tools/flow-spike`, Phase B).
 *
 * Converts an authored v1 `FlowDoc` (screens + transitions + per-event choreographies) into a v2
 * `FlowDoc` (event graph + z-ordered containers) FAITHFULLY, so an existing game (e.g. the Book of
 * Borut remake) migrates to v2 without hand-authoring. Pure + deterministic; the ONLY package that
 * depends on BOTH `engine-flow` (v1) and `engine-flow-v2`.
 *
 * Mapping (1:1 with the v2 constructs Phase A shipped):
 *  - screens → z-ordered containers (array order = stack).
 *  - each event = its book choreography + the show/hide/intent its transitions add:
 *      bookEvent → the event's chain gains hide(from)+show(to);
 *      complete  → a synthetic `complete:<from>` event (the game dispatches it when the screen ends);
 *      signal    → an event named `<signal>`; action → an invoke-intent action (+show/hide if from≠to);
 *      value     → SKIP (feed-gated overlays keep their component `visibleSource`);
 *      condition → SKIP (a Branch on an engine guard — a later refinement);
 *      the `initial` screen → shown on a `load` event.
 *  - choreography: sequence→exec chain, parallel→parallel, broadcast→fireCue{await}, effect→action,
 *      delay→delay(ms literal), forEach→forEach(body/done), branch→branch(then/else);
 *      FlowAccessor(literal/trigger/item/context/engine) → the matching v2 `DataSource`.
 *  - a declared param the v1 payload OMITTED defaults to `$trigger.<param>` (v1 passed `{}` there; this
 *    fills the v2 pin AND is more correct — the same-named event field flows through).
 */

import type {
	ChoreographyNode,
	FlowAccessor,
	FlowDoc as FlowDocV1,
	FlowGuard,
	FlowPayload,
} from 'engine-flow';
import type {
	Compare,
	ContainerRef,
	DataEdge,
	DataSource,
	ExecEdge,
	FlowDoc,
	Guard,
	Node,
	PinPath,
	TemplateVocabulary,
	TypeRef,
} from 'engine-flow-v2';

/** A compiled subtree: nodes + edges, an ENTRY node, and the exec-out TAIL pin(s) a sibling wires to. */
interface SubGraph {
	nodes: Node[];
	exec: ExecEdge[];
	data: DataEdge[];
	entry: string | null;
	tails: PinPath[];
}

/** Map a v1 action-transition `intent` → the v2 invoke-intent action ref (book-of default). */
export type IntentActionMap = (intent: string) => string | undefined;
const DEFAULT_INTENT_ACTIONS: IntentActionMap = (intent) =>
	({ spin: 'startSpin', stop: 'stopSpin', buyBonus: 'confirmBuyBonus' })[intent];

const paramType = (vocab: TemplateVocabulary, ref: string, pin: string): TypeRef | undefined => {
	const a = vocab.actions.find((x) => x.name === ref)?.params.find((p) => p.name === pin);
	if (a) return a.type;
	return vocab.cues.find((x) => x.name === ref)?.payload.find((p) => p.name === pin)?.type;
};

const inferLiteralType = (v: unknown): TypeRef => {
	if (typeof v === 'boolean') return { t: 'bool' };
	if (typeof v === 'number') return Number.isInteger(v) ? { t: 'int' } : { t: 'float' };
	return { t: 'string' };
};

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

const declaredParams = (vocab: TemplateVocabulary, ref: string) =>
	vocab.actions.find((a) => a.name === ref)?.params ??
	vocab.cues.find((c) => c.name === ref)?.payload ??
	[];

const toInputs = (
	vocab: TemplateVocabulary,
	ref: string,
	payload: FlowPayload | undefined,
): Record<string, DataSource> => {
	const inputs: Record<string, DataSource> = {};
	for (const [pin, acc] of Object.entries(payload ?? {}))
		inputs[pin] = toDataSource(acc, paramType(vocab, ref, pin));
	for (const p of declaredParams(vocab, ref)) {
		if (!(p.name in inputs))
			inputs[p.name] = { kind: 'accessor', path: { on: 'trigger', member: p.name } };
	}
	return inputs;
};

// v1 comparators → v2 (`neq`→`ne`; `in` (membership) has NO v2 equivalent → falls back to `eq`, a
// lossy but rare case — noted for the condition-transition refinement).
const OP_MAP: Record<string, Compare['op']> = {
	eq: 'eq',
	neq: 'ne',
	gt: 'gt',
	gte: 'gte',
	lt: 'lt',
	lte: 'lte',
};

/** v1 `FlowGuard` (an AND of predicates, `all`) → v2 `Guard` + the branch node's operand `inputs`. */
const toGuard = (g: FlowGuard): { guard: Guard; inputs: Record<string, DataSource> } => {
	const inputs: Record<string, DataSource> = {};
	const all: Compare[] = (g.all ?? []).map((p, i) => {
		inputs[`all.${i}.left`] = toDataSource(p.left);
		inputs[`all.${i}.right`] = toDataSource(p.right);
		return { left: toDataSource(p.left), op: OP_MAP[p.op] ?? 'eq', right: toDataSource(p.right) };
	});
	return { guard: all.length ? { all } : {}, inputs };
};

/** A per-translation unique-id generator (no module-global state — the translator stays pure). */
type Uid = (prefix: string) => string;

const compile = (node: ChoreographyNode, vocab: TemplateVocabulary, uid: Uid): SubGraph => {
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
			return {
				nodes: [
					{
						id,
						kind: 'fireCue',
						pos: { x: 0, y: 0 },
						ref: node.event,
						inputs: toInputs(vocab, node.event, node.payload),
						...(node.await ? { await: true } : {}),
					},
				],
				exec: [],
				data: [],
				entry: id,
				tails: [{ node: id, pin: 'exec' }],
			};
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
		case 'sequence':
			return chain(node.children.map((c) => compile(c, vocab, uid)));
		case 'parallel': {
			const id = uid('par');
			const kids = node.children.map((c) => compile(c, vocab, uid));
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
			return { nodes, exec, data, entry: id, tails: [] };
		}
		case 'forEach': {
			const id = uid('each');
			const body = compile(node.body, vocab, uid);
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
			const thenG = compile(node.then, vocab, uid);
			const elseG = node.otherwise ? compile(node.otherwise, vocab, uid) : undefined;
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

const makeUid = (): Uid => {
	let n = 0;
	return (prefix) => `${prefix}_${n++}`;
};

/** Translate a v1 event `{ event, choreography }` into a v2 `event` node + its exec/data graph. */
export const translateEventChoreography = (
	event: string,
	choreography: ChoreographyNode,
	vocab: TemplateVocabulary,
): { nodes: Node[]; exec: ExecEdge[]; data: DataEdge[] } => {
	const uid = makeUid();
	const eventId = `on_${event}`;
	const body = compile(choreography, vocab, uid);
	const nodes: Node[] = [
		{ id: eventId, kind: 'event', pos: { x: 0, y: 0 }, ref: event },
		...body.nodes,
	];
	const exec = [...body.exec];
	if (body.entry)
		exec.push({ from: { node: eventId, pin: 'exec' }, to: { node: body.entry, pin: 'exec' } });
	return { nodes, exec, data: body.data };
};

interface TransitionOp {
	hide?: string;
	show?: string;
	intent?: string;
}

const containerNode = (kind: 'showContainer' | 'hideContainer', ref: string, uid: Uid): Node => ({
	id: uid(kind === 'showContainer' ? 'show' : 'hide'),
	kind,
	pos: { x: 0, y: 0 },
	ref,
});

/** Translate a whole v1 `FlowDoc` into a v2 `FlowDoc`. */
export const translateFlowDoc = (
	v1: FlowDocV1,
	vocab: TemplateVocabulary,
	intentActions: IntentActionMap = DEFAULT_INTENT_ACTIONS,
): FlowDoc => {
	const uid = makeUid();
	const containers: ContainerRef[] = v1.screens.map((s, i) => ({
		id: s.id,
		sceneId: s.id,
		z: i * 10,
	}));

	const byEvent = new Map<string, { choreo?: ChoreographyNode; ops: TransitionOp[] }>();
	const bucket = (name: string) => {
		let e = byEvent.get(name);
		if (!e) byEvent.set(name, (e = { ops: [] }));
		return e;
	};
	for (const ev of v1.events ?? []) bucket(ev.event).choreo = ev.choreography;
	for (const t of v1.transitions ?? []) {
		const trig = t.trigger;
		if (trig.kind === 'bookEvent') bucket(trig.event).ops.push({ hide: t.from, show: t.to });
		else if (trig.kind === 'complete')
			bucket(`complete:${t.from}`).ops.push({ hide: t.from, show: t.to });
		else if (trig.kind === 'signal') bucket(trig.signal).ops.push({ hide: t.from, show: t.to });
		else if (trig.kind === 'action')
			bucket(trig.pin).ops.push({
				intent: intentActions(trig.intent),
				...(t.from !== t.to ? { hide: t.from, show: t.to } : {}),
			});
		// value / condition: skip (see header).
	}
	const initial = v1.screens.find((s) => s.initial);
	if (initial) bucket('load').ops.push({ show: initial.id });

	const nodes: Node[] = [];
	const exec: ExecEdge[] = [];
	const data: DataEdge[] = [];
	for (const [name, { choreo, ops }] of byEvent) {
		const eventId = `on_${name}`;
		nodes.push({ id: eventId, kind: 'event', pos: { x: 0, y: 0 }, ref: name });
		const parts: SubGraph[] = [];
		if (choreo) parts.push(compile(choreo, vocab, uid));
		for (const op of ops) {
			if (op.intent) {
				const id = uid('act');
				parts.push({
					nodes: [{ id, kind: 'action', pos: { x: 0, y: 0 }, ref: op.intent, inputs: {} }],
					exec: [],
					data: [],
					entry: id,
					tails: [{ node: id, pin: 'exec' }],
				});
			}
			if (op.hide) {
				const n = containerNode('hideContainer', op.hide, uid);
				parts.push({
					nodes: [n],
					exec: [],
					data: [],
					entry: n.id,
					tails: [{ node: n.id, pin: 'exec' }],
				});
			}
			if (op.show) {
				const n = containerNode('showContainer', op.show, uid);
				parts.push({
					nodes: [n],
					exec: [],
					data: [],
					entry: n.id,
					tails: [{ node: n.id, pin: 'exec' }],
				});
			}
		}
		const body = chain(parts);
		nodes.push(...body.nodes);
		exec.push(...body.exec);
		data.push(...body.data);
		if (body.entry)
			exec.push({ from: { node: eventId, pin: 'exec' }, to: { node: body.entry, pin: 'exec' } });
	}

	return { version: 2, templateId: vocab.templateId, graph: { nodes, exec, data }, containers };
};
