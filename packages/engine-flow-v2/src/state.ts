/**
 * Invisible Flow v2 — game VARIABLES, TIMERS and TICK (`docs/design/game-families.md` §3.1–§3.2).
 *
 * The interpreter is created fresh for every event, so nothing that must outlive a run can live in
 * it. This is the store that does: one per game session, held by whoever runs the flow (the game's
 * holder, `apps/lines` `flowV2InterpreterHolder.ts`, or the headless preview) and reached by the
 * interpreter through `FlowV2Env.state`. It is pure: no ticker, no Svelte, no timers of its own —
 * the holder advances it (`advance(dtMs)`) and delivers what it reports.
 *
 * The rules, all of them here so the game and the preview cannot drift:
 *  - A WRITE APPLIES AT ONCE, at the node that makes it; `change` is one read-modify-write. A value
 *    of the wrong kind is dropped, never stored. The last write in execution order wins.
 *  - CHANGES ARE DELIVERED IN A BATCH (`flush`), once per frame: subscribers (`var:<id>` value
 *    sources) hear each changed variable once, and the batch lists every write, in order, for the
 *    `onVariable` entries (`variableEntries`).
 *  - SCOPES: `game` variables keep their value; `round` ones go back to `initial` on `resetRound`;
 *    a mode's own go back on `enterMode(id)`. A reset is a write like any other.
 *  - TIMERS run only while `advance` is called (the game drives it from its ticker, so a paused game
 *    pauses them) and fire in time order within a step; a `paused` timer holds where it is.
 *  - TICKS: an `onTick` with no `every` fires once per `advance`; one with `every` fires each time
 *    that much time has gone by, with `dt = every`.
 */

import type { ChangeVariableOp, FlowDoc, Graph, Node, OnVariableNode } from './types';
import { flattenGroups } from './collapse';
import type { FlowStateEntry } from './runtime';
import {
	coerceVariableValue,
	docVariables,
	variableSourceName,
	type FlowVariableDecl,
} from './variables';

/** One write that changed a variable. */
export interface FlowVariableWrite {
	id: string;
	previous: unknown;
	value: unknown;
}

/** What `advance` says is due, in the order it is due. `at` is ms into the step. */
export type FlowStateDue =
	| { kind: 'timer'; at: number; timer: string }
	| { kind: 'tick'; at: number; node: string; dt: number };

/** The part of the store a run reaches through `FlowV2Env.state`. */
export interface FlowStateAccess {
	read(id: string): unknown;
	write(id: string, value: unknown): void;
	change(
		id: string,
		op: ChangeVariableOp,
		by: unknown,
		clamp: { min?: number; max?: number },
	): void;
	startTimer(id: string, ms: number, repeat: boolean): void;
	stopTimer(id: string): void;
	pauseTimer(id: string, paused: boolean): void;
}

export interface FlowState extends FlowStateAccess {
	/** Put every `round` variable back to its initial. */
	resetRound(): void;
	/** Put mode `modeId`'s own variables back to their initial (the mode was entered). */
	enterMode(modeId: string): void;
	/** Move the clock on by `dtMs`: what timers and ticks are due, in order. */
	advance(dtMs: number): FlowStateDue[];
	/** Take the writes since the last flush and tell the subscribers of each variable they changed. */
	flush(): FlowVariableWrite[];
	/** Does anything wait to be flushed? */
	pending(): boolean;
	/** Follow variable `id` (the Svelte-store contract: `run` at once, then on each flushed change). */
	subscribe(id: string, run: (value: unknown) => void): () => void;
	/** Is a timer running (started, not stopped or spent)? */
	timerRunning(id: string): boolean;
	/** Will `advance` ever report something again — an unpaused timer, or a tick node? */
	live(): boolean;
}

/** The most a timer or a tick may fire in one `advance` (a 1 ms repeat on a long frame). */
const MAX_FIRES_PER_STEP = 1000;

/** How close a sum of frame steps (each 1000/60 ms) may fall short of a due time and still be due:
 *  sixty 16.67 ms frames add up to 999.9999… ms, not 1000. */
const DUE_EPSILON = 1e-6;

/** The shortest period a repeating timer runs at, so a 0 ms repeat cannot fire forever. */
const MIN_REPEAT_MS = 1;

interface Timer {
	ms: number;
	remaining: number;
	repeat: boolean;
	paused: boolean;
}

/** The doc's graphs: its own, then each mode's. */
const graphsOf = (doc: FlowDoc): Graph[] => [
	doc.graph,
	...Object.values(doc.modes ?? {}).flatMap((scope) => (scope?.graph ? [scope.graph] : [])),
];

/** Every `onTick` node of the doc's graphs, groups flattened as the interpreter flattens them (so
 *  the ids match the ones a run looks up), with its period. This runs as the game boots, so a group
 *  that will not flatten never takes the game down here: its graph's ticks are read off the stored
 *  nodes instead. */
const tickNodes = (doc: FlowDoc): { id: string; every?: number }[] =>
	graphsOf(doc).flatMap((graph) => {
		let nodes: Node[];
		try {
			nodes = flattenGroups(graph).nodes;
		} catch {
			nodes = graph.nodes ?? [];
		}
		return nodes.flatMap((n) =>
			n?.kind === 'onTick'
				? [{ id: n.id, every: n.every && n.every > 0 ? n.every : undefined }]
				: [],
		);
	});

/** Build the store for `doc`: every variable at its initial, no timer running. */
export const createFlowState = (doc: FlowDoc): FlowState => {
	const decls = new Map(docVariables(doc).map((v) => [v.id, v] as const));
	const values = new Map<string, unknown>();
	for (const v of decls.values()) values.set(v.id, coerceVariableValue(v, v.initial));
	const timers = new Map<string, Timer>();
	const ticks = tickNodes(doc).map((t) => ({ ...t, since: 0 }));
	let writes: FlowVariableWrite[] = [];
	const subscribers = new Map<string, Set<(value: unknown) => void>>();

	const write = (id: string, value: unknown): void => {
		const decl = decls.get(id);
		if (!decl) return;
		const next = coerceVariableValue(decl, value);
		if (next === undefined) return;
		const previous = values.get(id);
		if (Object.is(previous, next)) return;
		values.set(id, next);
		writes.push({ id, previous, value: next });
	};

	const reset = (pick: (v: FlowVariableDecl) => boolean): void => {
		for (const v of decls.values()) if (pick(v)) write(v.id, v.initial);
	};

	return {
		read: (id) => values.get(id),
		write,
		change: (id, op, by, { min, max }) => {
			const decl = decls.get(id);
			if (!decl) return;
			const current = values.get(id);
			if (op === 'toggle') {
				if (decl.type === 'bool') write(id, current !== true);
				return;
			}
			if (decl.type !== 'int' && decl.type !== 'float') return;
			const step = by === undefined ? 1 : by;
			if (typeof step !== 'number' || !Number.isFinite(step)) return;
			let next = Number(current) + (op === 'sub' ? -step : step);
			if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
			if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);
			write(id, next);
		},
		startTimer: (id, ms, repeat) => {
			const length = Number.isFinite(ms) && ms > 0 ? ms : 0;
			const period = repeat ? Math.max(MIN_REPEAT_MS, length) : length;
			timers.set(id, { ms: period, remaining: period, repeat, paused: false });
		},
		stopTimer: (id) => void timers.delete(id),
		pauseTimer: (id, paused) => {
			const timer = timers.get(id);
			if (timer) timer.paused = paused;
		},
		resetRound: () => reset((v) => v.scope === 'round'),
		enterMode: (modeId) => reset((v) => v.mode === modeId),
		advance: (dtMs) => {
			const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
			const due: FlowStateDue[] = [];
			for (const [id, timer] of [...timers]) {
				if (timer.paused) continue;
				let left = timer.remaining - dt;
				let fires = 0;
				while (left <= DUE_EPSILON && fires < MAX_FIRES_PER_STEP) {
					due.push({ kind: 'timer', at: dt + left, timer: id });
					fires += 1;
					if (!timer.repeat) break;
					left += timer.ms;
				}
				if (!timer.repeat && left <= DUE_EPSILON) timers.delete(id);
				else timer.remaining = left;
			}
			for (const tick of ticks) {
				if (tick.every === undefined) {
					due.push({ kind: 'tick', at: dt, node: tick.id, dt });
					continue;
				}
				tick.since += dt;
				let fires = 0;
				while (tick.since >= tick.every - DUE_EPSILON && fires < MAX_FIRES_PER_STEP) {
					tick.since -= tick.every;
					due.push({ kind: 'tick', at: dt - tick.since, node: tick.id, dt: tick.every });
					fires += 1;
				}
			}
			// Time order; a tie keeps the order above (timers, then ticks, each in doc order).
			return due
				.map((d, i) => ({ d, i }))
				.sort((a, b) => a.d.at - b.d.at || a.i - b.i)
				.map(({ d }) => d);
		},
		flush: () => {
			const batch = writes;
			writes = [];
			const changed = [...new Set(batch.map((w) => w.id))];
			for (const id of changed) {
				for (const run of [...(subscribers.get(id) ?? [])]) run(values.get(id));
			}
			return batch;
		},
		pending: () => writes.length > 0,
		subscribe: (id, run) => {
			let set = subscribers.get(id);
			if (!set) subscribers.set(id, (set = new Set()));
			set.add(run);
			run(values.get(id));
			return () => void set.delete(run);
		},
		timerRunning: (id) => timers.has(id),
		live: () => ticks.length > 0 || [...timers.values()].some((t) => !t.paused),
	};
};

/** Does `doc` use any of this module — a variable, a key map, or a tick / timer / input node? A
 *  doc that uses none needs no store and no ticker (every slot doc authored before P10.3). */
export const flowUsesState = (doc: FlowDoc): boolean =>
	docVariables(doc).length > 0 ||
	(doc.inputs?.length ?? 0) > 0 ||
	graphsOf(doc).some(graphUsesState);

const STATE_NODES: ReadonlySet<Node['kind']> = new Set([
	'setVariable',
	'changeVariable',
	'onVariable',
	'onTick',
	'onTimer',
	'onInput',
	'startTimer',
	'stopTimer',
	'pauseTimer',
]);

const graphUsesState = (graph: Graph): boolean =>
	graph.nodes.some(
		(n) => STATE_NODES.has(n.kind) || (n.kind === 'group' && !!n.body && graphUsesState(n.body)),
	);

/** Does a write `previous → value` cross `threshold` the way `direction` watches? */
export const crossesThreshold = (
	previous: unknown,
	value: unknown,
	threshold: number,
	direction: OnVariableNode['direction'] = 'either',
): boolean => {
	const a = Number(previous);
	const b = Number(value);
	if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
	const up = a < threshold && b >= threshold;
	const down = a > threshold && b <= threshold;
	return direction === 'up' ? up : direction === 'down' ? down : up || down;
};

/** What one `onVariable` entry runs on a flushed batch. */
export interface FlowVariableEntryRun {
	node: string;
	value: unknown;
	previous: unknown;
}

/**
 * The `onVariable` entries of `graph` a flushed batch fires, in order: a `changed` entry once per
 * batch (its variable's latest value against its value before the batch; a batch that left it where
 * it was fires nothing), a `crosses` entry once per write that crossed its threshold.
 */
export const variableEntries = (
	graph: Graph,
	batch: readonly FlowVariableWrite[],
): FlowVariableEntryRun[] => {
	const runs: FlowVariableEntryRun[] = [];
	for (const node of graph.nodes) {
		if (node.kind !== 'onVariable') continue;
		const own = batch.filter((w) => w.id === node.variable);
		if (!own.length) continue;
		if ((node.on ?? 'changed') === 'changed') {
			const previous = own[0].previous;
			const value = own[own.length - 1].value;
			if (!Object.is(previous, value)) runs.push({ node: node.id, value, previous });
			continue;
		}
		if (typeof node.threshold !== 'number' || !Number.isFinite(node.threshold)) continue;
		for (const w of own) {
			if (crossesThreshold(w.previous, w.value, node.threshold, node.direction))
				runs.push({ node: node.id, value: w.value, previous: w.previous });
		}
	}
	return runs;
};

/** A value source as engine-layout's registry takes one (`registerComponentValues`). */
export interface FlowVariableValueSource {
	subscribe(run: (value: number | string) => void): () => void;
}

/**
 * Each variable as the value source `var:<id>` (§3.1), for the game to register beside its engine
 * values: a component input with `source: 'var:score'` follows it with no wire. A number or a string
 * passes as it is; a bool passes as 1 / 0, which a bool input reads as on / off. Subscribers hear
 * each change once per flush, never once per write.
 */
export const variableValueSources = (
	state: FlowState,
	variables: readonly FlowVariableDecl[],
): Record<string, FlowVariableValueSource> =>
	Object.fromEntries(
		variables.map((v) => [
			variableSourceName(v.id),
			{
				subscribe: (run: (value: number | string) => void) =>
					state.subscribe(v.id, (value) => {
						if (typeof value === 'boolean') run(value ? 1 : 0);
						else if (typeof value === 'number' || typeof value === 'string') run(value);
					}),
			},
		]),
	);

/**
 * ONE FRAME of the store (game-families §3.1–§3.2), the rule the game and the preview both run, so
 * the two cannot drift: first the writes made since the last frame are delivered as one batch (its
 * subscribers hear each variable once, and `run` gets the batch for the `onVariable` entries), then
 * the clock moves on by `dtMs` and `run` gets each timer and tick that came due, in time order. A
 * write made by any of these chains — at once or after a wait — goes out with the next frame.
 * Returns how many entries it handed to `run`.
 */
export const stepFlowState = (
	state: FlowState,
	dtMs: number,
	run: (entry: FlowStateEntry) => void,
): number => {
	let entries = 0;
	if (state.pending()) {
		run({ kind: 'variables', batch: state.flush() });
		entries += 1;
	}
	for (const due of state.advance(dtMs)) {
		run(
			due.kind === 'timer'
				? { kind: 'timer', timer: due.timer }
				: { kind: 'tick', node: due.node, dt: due.dt },
		);
		entries += 1;
	}
	return entries;
};
