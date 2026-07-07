/**
 * Invisible Flow v2 — the DEDICATED runtime interpreter (schema §10). This is NOT a compiler
 * to the v1 `engine-flow` executor: v2 is richer (dynamic delays fed by `compute`, arithmetic
 * nodes, function inputs/outputs with recursion) than v1's tree, so it is walked directly.
 *
 * The interpreter is PURE logic over an INJECTED environment (`FlowV2Env`) — it never imports
 * a Svelte-rune module, an emitter, or `setTimeout`; a game (or a headless harness) wires those
 * once. That keeps it testable (record the env calls) and keeps the timing REAL (every effect /
 * broadcast / delay is awaited, so a recorded log reflects the true order + resolved durations).
 *
 * It walks two kinds of edges from the schema graph:
 *  - EXEC edges (control): `execFrom(node, execPin)` runs a node, then follows its outgoing exec
 *    edge from that out-pin to the next node. An exec-out with no edge ends the chain.
 *  - DATA edges (value): `resolveDataIn(node, pin)` pulls a value — from a wired source
 *    (event payload / forEach item|index / function input / a `functionCall`'s cached output /
 *    a `compute` evaluated on demand), or from the node's own `DataSource` (literal / accessor).
 *
 * Robustness mirrors v1's parity-safe stance: unknown refs, missing edges, and authored-but-
 * incomplete graphs resolve to a sensible no-op / `undefined` — never a thrown error — so a
 * partially-authored flow degrades gracefully rather than crashing a live round.
 */

import type {
	Accessor,
	BranchNode,
	Compare,
	ComputeNode,
	ComputeOp,
	DataSource,
	FlowDoc,
	ForEachNode,
	FunctionLibraryDoc,
	Graph,
	Guard,
	Node,
	NodeId,
	PinPath,
	TemplateVocabulary,
} from './types';

// ---------------------------------------------------------------------------
// The injected runtime environment. A game wires these to the SAME primitives the coded
// path uses (the emitter, the generic scene mounter, `stateBet` turbo, `waitForTimeout`);
// a harness wires a recorder. The interpreter only ever talks to this surface.
// ---------------------------------------------------------------------------

export interface FlowV2Env {
	/** An `action` node — invoke a named template effect/command with its resolved payload. */
	effect(name: string, payload: Record<string, unknown>): void | Promise<void>;
	/** A `fireCue` node — broadcast a named cue (with any resolved payload). */
	broadcast(cue: string, payload: Record<string, unknown>): void | Promise<void>;
	/** A `delay` node — wait the (already turbo-scaled) duration. */
	waitForTimeout(ms: number): Promise<void>;
	/** The live turbo scalar (`() => isTurbo ? 2 : 1`); a `delay`'s ms is divided by it. */
	timeScale(): number;
	/** A `showContainer` node — mount the referenced scene at the given z. */
	showContainer(containerId: string, z: number): void | Promise<void>;
	/** A `hideContainer` node — unmount the referenced container. */
	hideContainer(containerId: string): void | Promise<void>;
	/** An `$engine.<key>` accessor read — a template global (e.g. `reels`, `slots`). */
	engineRead(key: string): unknown;
}

/** The lookups + environment a run needs — the template contract, the function library,
 *  and the injected side-effect surface. */
export interface RunContext {
	vocab: TemplateVocabulary;
	library: FunctionLibraryDoc;
	env: FlowV2Env;
}

// ---------------------------------------------------------------------------
// The execution scope — the values a node can read while its chain runs. Threaded
// immutably: a forEach seeds `{ ...scope, item, index }`, a functionCall seeds
// `{ trigger, input }` for the body (a function body sees no outer item/index).
// ---------------------------------------------------------------------------

interface Scope {
	/** The event payload that seeded this run (`$trigger.*` — read as the event's data-outs). */
	trigger: Record<string, unknown>;
	/** The current forEach element (`$item[.member]`), when inside a loop body. */
	item?: unknown;
	/** The current forEach counter (`$index`), when inside a loop body. */
	index?: number;
	/** A function's resolved inputs (`$input.<name>`), when inside a function body. */
	input?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// A per-run interpreter instance. Holds the doc/library/vocab/env + a cache of each
// `functionCall`'s resolved outputs (a call runs earlier in the exec order, so a later
// data read pulls its cached outputs) keyed by call NodeId.
// ---------------------------------------------------------------------------

class FlowInterpreter {
	private readonly nodesById = new Map<NodeId, Node>();
	/** Cached outputs per `functionCall` node id → { outputPinId: value }. */
	private readonly callOutputs = new Map<NodeId, Record<string, unknown>>();

	constructor(
		private readonly doc: FlowDoc,
		private readonly ctx: RunContext,
	) {
		this.indexNodes(doc.graph);
		// A function body's nodes must also resolve by id (recursion into a call's body).
		for (const fn of ctx.library.functions) this.indexNodes(fn.body);
	}

	private indexNodes(graph: Graph): void {
		for (const node of graph.nodes) this.nodesById.set(node.id, node);
	}

	/** Find the `event` node reacting to `eventName`, seed the trigger scope, and run. */
	async runEvent(eventName: string, payload: Record<string, unknown>): Promise<void> {
		const entry = this.doc.graph.nodes.find((n) => n.kind === 'event' && n.ref === eventName);
		if (!entry) return; // no authored handler for this event → parity-safe no-op.
		await this.execFrom(this.doc.graph, entry.id, 'exec', { trigger: payload });
	}

	// -------------------------------------------------------------------------
	// Exec walk. Run the node at `nodeId`, then follow its outgoing exec edge FROM
	// `execPinId` (within `graph`) to the next node and continue. Some nodes drive their
	// own follow-on (branch/forEach/sequence/parallel/functionCall) and return the pin(s)
	// to continue from; the default is a single `exec` out.
	// -------------------------------------------------------------------------

	private async execFrom(
		graph: Graph,
		nodeId: NodeId,
		execPinId: string,
		scope: Scope,
	): Promise<void> {
		let node: Node | undefined = this.nodesById.get(nodeId);
		let pin = execPinId;
		// Loop the linear default case to avoid deep recursion on long chains.
		while (node) {
			const next: PinPath | undefined = await this.runNode(graph, node, pin, scope);
			if (!next) return;
			node = this.nodesById.get(next.node);
			pin = next.pin;
		}
	}

	/** Follow the single outgoing exec edge from `(nodeId, pinId)`; `undefined` if none. */
	private nextExec(graph: Graph, nodeId: NodeId, pinId: string): PinPath | undefined {
		const edge = graph.exec.find((e) => e.from.node === nodeId && e.from.pin === pinId);
		return edge?.to;
	}

	/** Run all subchains reachable from `(nodeId, pinId)` to completion (a helper for the
	 *  branch/sequence/parallel/forEach follow-ons that must AWAIT a whole subchain). */
	private async runExecChain(
		graph: Graph,
		nodeId: NodeId,
		pinId: string,
		scope: Scope,
	): Promise<void> {
		const next = this.nextExec(graph, nodeId, pinId);
		if (next) await this.execFrom(graph, next.node, next.pin, scope);
	}

	// -------------------------------------------------------------------------
	// Per-node behaviour. Returns the next `PinPath` to continue the linear walk from, or
	// `undefined` when this node has already driven its own continuation (or ends a chain).
	// -------------------------------------------------------------------------

	private async runNode(
		graph: Graph,
		node: Node,
		execPinId: string,
		scope: Scope,
	): Promise<PinPath | undefined> {
		switch (node.kind) {
			case 'event':
			case 'functionEntry':
				// Exec START points: their job is just to hand off to the exec-out.
				return this.nextExec(graph, node.id, 'exec');

			case 'action':
				await this.ctx.env.effect(node.ref, this.resolvePayload(graph, node, scope));
				return this.nextExec(graph, node.id, 'exec');

			case 'fireCue':
				await this.ctx.env.broadcast(node.ref, this.resolvePayload(graph, node, scope));
				return this.nextExec(graph, node.id, 'exec');

			case 'delay': {
				const ms = Number(this.resolveDataIn(graph, node.id, 'ms', scope));
				const scale = this.ctx.env.timeScale() || 1;
				await this.ctx.env.waitForTimeout((Number.isFinite(ms) ? ms : 0) / scale);
				return this.nextExec(graph, node.id, 'exec');
			}

			case 'showContainer': {
				await this.ctx.env.showContainer(node.ref, this.zOf(node.ref));
				return this.nextExec(graph, node.id, 'exec');
			}

			case 'hideContainer': {
				await this.ctx.env.hideContainer(node.ref);
				return this.nextExec(graph, node.id, 'exec');
			}

			case 'branch': {
				const taken = this.evalGuard(graph, node, scope) ? 'then' : 'else';
				return this.nextExec(graph, node.id, taken);
			}

			case 'forEach': {
				await this.runForEach(graph, node, scope);
				return this.nextExec(graph, node.id, 'done');
			}

			case 'sequence': {
				for (let i = 0; i < Math.max(0, node.count); i++) {
					await this.runExecChain(graph, node.id, `then[${i}]`, scope);
				}
				return undefined; // its subchains carry the flow; nothing linear follows.
			}

			case 'parallel': {
				const runs: Promise<void>[] = [];
				for (let i = 0; i < Math.max(0, node.count); i++) {
					runs.push(this.runExecChain(graph, node.id, `then[${i}]`, scope));
				}
				await Promise.all(runs);
				return undefined;
			}

			case 'functionCall': {
				await this.runFunctionCall(graph, node, scope);
				return this.nextExec(graph, node.id, 'exec');
			}

			case 'functionResult':
			case 'compute':
				// A result ends a function body (its data-ins are pulled by the caller); a compute
				// is pure and never exec-run (pulled during data resolution). Nothing to continue.
				return undefined;
		}
	}

	// -------------------------------------------------------------------------
	// forEach. Iterate the resolved list; each iteration seeds `{ ...scope, item, index }`
	// and runs the `body` exec chain to completion. `sequence` awaits each in order;
	// `parallel` runs them concurrently. The `done` continuation is followed by the caller.
	// -------------------------------------------------------------------------

	private async runForEach(graph: Graph, node: ForEachNode, scope: Scope): Promise<void> {
		const list = this.resolveDataIn(graph, node.id, 'in', scope);
		const items = Array.isArray(list) ? list : [];
		const iterate = (item: unknown, index: number): Promise<void> =>
			this.runExecChain(graph, node.id, 'body', { ...scope, item, index });

		if (node.mode === 'parallel') {
			await Promise.all(items.map((item, i) => iterate(item, i)));
		} else {
			for (let i = 0; i < items.length; i++) await iterate(items[i], i);
		}
	}

	// -------------------------------------------------------------------------
	// functionCall. Resolve each declared data input in the CURRENT scope, run the target
	// function's body (seeded with `{ trigger, input }`), capture the `functionResult`'s
	// data-ins as the call's outputs, and cache them by the call's id for later data reads.
	// -------------------------------------------------------------------------

	private async runFunctionCall(
		graph: Graph,
		node: Node & { ref: string },
		scope: Scope,
	): Promise<void> {
		const fn = this.ctx.library.functions.find((f) => f.id === node.ref);
		if (!fn) {
			this.callOutputs.set(node.id, {}); // unknown function → no outputs, parity-safe.
			return;
		}

		// Build the input map from the FunctionDef's declared data inputs, resolved in the
		// caller's scope (a wired data-in pulls its edge; else the call node's own DataSource).
		const input: Record<string, unknown> = {};
		for (const pin of fn.inputs) {
			if (pin.kind !== 'data') continue;
			input[pin.id] = this.resolveDataIn(graph, node.id, pin.id, scope);
		}

		const bodyScope: Scope = { trigger: scope.trigger, input };
		const entry = fn.body.nodes.find((n) => n.kind === 'functionEntry' && n.ref === fn.id);
		if (entry) await this.execFrom(fn.body, entry.id, 'exec', bodyScope);

		// Capture the outputs from the body's functionResult data-ins.
		const result = fn.body.nodes.find((n) => n.kind === 'functionResult' && n.ref === fn.id);
		const outputs: Record<string, unknown> = {};
		if (result) {
			for (const pin of fn.outputs) {
				if (pin.kind !== 'data') continue;
				outputs[pin.id] = this.resolveDataIn(fn.body, result.id, pin.id, bodyScope);
			}
		}
		this.callOutputs.set(node.id, outputs);
	}

	// -------------------------------------------------------------------------
	// Data resolution. If a data edge feeds `(nodeId, pinId)`, resolve its SOURCE pin;
	// otherwise fall back to the node's own `DataSource` (literal / accessor / unwired wire).
	// -------------------------------------------------------------------------

	private resolveDataIn(graph: Graph, nodeId: NodeId, pinId: string, scope: Scope): unknown {
		const edge = graph.data.find((e) => e.to.node === nodeId && e.to.pin === pinId);
		if (edge) return this.resolveDataOut(graph, edge.from, scope);

		const node = this.nodesById.get(nodeId);
		const src = node?.inputs?.[pinId];
		if (!src) return undefined;
		return this.resolveDataSource(src, scope);
	}

	/** Resolve the value produced at a data-OUT `(srcNode, srcPin)`. */
	private resolveDataOut(graph: Graph, from: PinPath, scope: Scope): unknown {
		const src = this.nodesById.get(from.node);
		if (!src) return undefined;
		switch (src.kind) {
			case 'event':
				// An event data-out IS the payload field named by the pin id.
				return scope.trigger[from.pin];
			case 'forEach':
				if (from.pin === 'item') return scope.item;
				if (from.pin === 'index') return scope.index;
				return undefined;
			case 'functionEntry':
				// A function-entry data-out IS the matching input (pin id = input name).
				return scope.input?.[from.pin];
			case 'functionCall':
				// The call already executed earlier in the exec order → read its cached output.
				return this.callOutputs.get(from.node)?.[from.pin];
			case 'compute':
				return this.evalCompute(graph, src, scope);
			default:
				return undefined;
		}
	}

	/** Resolve a literal / accessor / (unwired) wire `DataSource` in scope. */
	private resolveDataSource(src: DataSource, scope: Scope): unknown {
		switch (src.kind) {
			case 'literal':
				return src.value;
			case 'accessor':
				return this.resolveAccessor(src.path, scope);
			case 'wire':
				return undefined; // a wire with no data edge → unfilled.
		}
	}

	private resolveAccessor(acc: Accessor, scope: Scope): unknown {
		switch (acc.on) {
			case 'item':
				if (acc.member === undefined) return scope.item;
				return isRecord(scope.item) ? scope.item[acc.member] : undefined;
			case 'index':
				return scope.index;
			case 'input':
				return scope.input?.[acc.name];
			case 'engine':
				return this.ctx.env.engineRead(acc.key);
		}
	}

	// -------------------------------------------------------------------------
	// compute. A pure value op, pulled on demand: resolve its operand DataSources
	// (a `wire` operand pulls that compute's own data edge) and apply the op.
	// -------------------------------------------------------------------------

	private evalCompute(graph: Graph, node: ComputeNode, scope: Scope): unknown {
		const op: ComputeOp = node.compute;
		if (op.op === 'member') {
			const on = this.resolveOperand(graph, node.id, 'on', op.on, scope);
			return isRecord(on) ? on[op.member] : undefined;
		}
		const a = Number(this.resolveOperand(graph, node.id, 'a', op.a, scope));
		const b = Number(this.resolveOperand(graph, node.id, 'b', op.b, scope));
		const av = Number.isFinite(a) ? a : 0;
		const bv = Number.isFinite(b) ? b : 0;
		switch (op.op) {
			case 'add':
				return av + bv;
			case 'sub':
				return av - bv;
			case 'mul':
				return av * bv;
			case 'div':
				return bv === 0 ? 0 : av / bv;
		}
	}

	/** Resolve a single compute operand: a `wire` source pulls the compute's own data edge
	 *  at that pin; a literal/accessor resolves in scope. */
	private resolveOperand(
		graph: Graph,
		nodeId: NodeId,
		pinId: string,
		src: DataSource,
		scope: Scope,
	): unknown {
		if (src.kind === 'wire') return this.resolveDataIn(graph, nodeId, pinId, scope);
		return this.resolveDataSource(src, scope);
	}

	// -------------------------------------------------------------------------
	// Guards (branch). A small comparison set — resolve each Compare's operands, apply the
	// op; `all` = AND, `any` = OR. An empty guard is vacuously true.
	// -------------------------------------------------------------------------

	private evalGuard(graph: Graph, node: BranchNode, scope: Scope): boolean {
		const guard: Guard = node.guard;
		const cmp = (c: Compare, i: number, group: 'all' | 'any'): boolean => {
			const left = this.resolveOperand(graph, node.id, `${group}.${i}.left`, c.left, scope);
			const right = this.resolveOperand(graph, node.id, `${group}.${i}.right`, c.right, scope);
			return compare(left, c.op, right);
		};
		const all = guard.all ?? [];
		const any = guard.any ?? [];
		const allOk = all.every((c, i) => cmp(c, i, 'all'));
		const anyOk = any.length === 0 ? true : any.some((c, i) => cmp(c, i, 'any'));
		return allOk && anyOk;
	}

	// -------------------------------------------------------------------------
	// payload. `{}` keyed by each of the node's DATA-IN pin ids → its resolved value.
	// (For an action/fireCue whose ref doesn't resolve, there are no declared params, so
	// its `inputs` map is the only pin source — mirror it directly.)
	// -------------------------------------------------------------------------

	private resolvePayload(
		graph: Graph,
		node: Node & { ref: string },
		scope: Scope,
	): Record<string, unknown> {
		const pinIds = this.payloadPinIds(node);
		const payload: Record<string, unknown> = {};
		for (const pinId of pinIds) payload[pinId] = this.resolveDataIn(graph, node.id, pinId, scope);
		return payload;
	}

	/** The DATA-IN pin ids of an action/fireCue: the declared params, unioned with any keys
	 *  present in the node's own `inputs` map (robust to an unresolved ref). */
	private payloadPinIds(node: Node & { ref: string }): string[] {
		const ids = new Set<string>(Object.keys(node.inputs ?? {}));
		if (node.kind === 'action') {
			const decl = this.ctx.vocab.actions.find((a) => a.name === node.ref);
			for (const p of decl?.params ?? []) ids.add(p.name);
		} else if (node.kind === 'fireCue') {
			const decl = this.ctx.vocab.cues.find((c) => c.name === node.ref);
			for (const p of decl?.payload ?? []) ids.add(p.name);
		}
		return [...ids];
	}

	private zOf(containerId: string): number {
		return this.doc.containers.find((c) => c.id === containerId)?.z ?? 0;
	}
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The bounded comparison set (schema §3 Guard) — no coercion beyond number/string equality. */
const compare = (left: unknown, op: Compare['op'], right: unknown): boolean => {
	switch (op) {
		case 'eq':
			return left === right;
		case 'ne':
			return left !== right;
		case 'lt':
			return numeric(left) < numeric(right);
		case 'lte':
			return numeric(left) <= numeric(right);
		case 'gt':
			return numeric(left) > numeric(right);
		case 'gte':
			return numeric(left) >= numeric(right);
	}
};

const numeric = (v: unknown): number => {
	const n = Number(v);
	return Number.isFinite(n) ? n : NaN;
};

// ---------------------------------------------------------------------------
// The one entry point a game (or harness) calls when a book/game event fires.
// ---------------------------------------------------------------------------

/**
 * Run the authored handler for `eventName` with `payload`. Finds the matching `event` node,
 * seeds a trigger scope, and walks its exec chain. If no `event` node reacts to `eventName`,
 * it is a no-op (parity-safe: an un-authored event falls through to the coded handler).
 */
export const runFlowEvent = async (
	doc: FlowDoc,
	ctx: RunContext,
	eventName: string,
	payload: Record<string, unknown>,
): Promise<void> => {
	const interpreter = new FlowInterpreter(doc, ctx);
	await interpreter.runEvent(eventName, payload);
};
