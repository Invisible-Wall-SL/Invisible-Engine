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

import { flattenGroups } from './collapse';
import { containerEventDeclId } from './containerEvents';
import type {
	Accessor,
	BranchNode,
	Compare,
	ComputeNode,
	ComputeOp,
	ContainerId,
	DataSource,
	DelayNode,
	FlowDoc,
	ForEachNode,
	FunctionId,
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
	/** A `showContainer` node with `awaitComplete` — resolve once the container next COMPLETES (its
	 *  `complete:<id>` fires and it is hidden). Blocks the exec chain so an authored overlay holds the
	 *  round until the player taps. Optional: an env without it (a pure recorder) makes the hold a
	 *  no-op (resolves immediately), so a headless harness never deadlocks. */
	awaitContainerComplete?(containerId: string): Promise<void>;
	/** A `showContainer` node's `durationMs` data-out — the wall-clock ms of the container's backing
	 *  scene's LONGEST animation (max over its spine/effect nodes), so an author can wire it into a
	 *  Delay's `ms` and hold for exactly the screen's animation. The env maps the containerId → its
	 *  scene → duration; the generic runtime needs no access to the doc's containers. Optional: an env
	 *  without it (a pure recorder) resolves the pin to `0`, so a headless harness never depends on
	 *  loaded assets. */
	containerAnimationMs?(containerId: string): number;
	/** An `$engine.<key>` accessor read — a template global (e.g. `reels`, `slots`). */
	engineRead(key: string): unknown;
	/** A `textMessage` node's `show`/`hide` exec — raise or clear the node's FLOW-SHOWN flag (the game
	 *  OR-s it with the node's `visibleWhile` state-gate to decide the overlay's visibility). Optional:
	 *  a pure recorder env without it makes show/hide a no-op, so a headless harness never renders. */
	setMessageShown?(nodeId: string, shown: boolean): void;
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
	/** The dispatch context that seeded this run (`$context.*` — e.g. the surrounding `bookEvents`
	 *  list a coded handler's second argument carries). Empty `{}` when the game passes none. */
	context: Record<string, unknown>;
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
	/** Each function's body FLATTENED of groups (§5.2), keyed by function id. */
	private readonly fnBodies = new Map<FunctionId, Graph>();

	private readonly doc: FlowDoc;

	constructor(
		doc: FlowDoc,
		private readonly ctx: RunContext,
	) {
		// §5.2: FLATTEN all `group` nodes back into their bodies BEFORE interpreting — a group is a pure
		// fold, semantically identical to its expanded form, so the interpreter never sees one. Function
		// bodies may also carry groups, so flatten those too.
		this.doc = { ...doc, graph: flattenGroups(doc.graph) };
		this.indexNodes(this.doc.graph);
		// A function body's nodes must also resolve by id (recursion into a call's body).
		for (const fn of ctx.library.functions) {
			const body = flattenGroups(fn.body);
			this.fnBodies.set(fn.id, body);
			this.indexNodes(body);
		}
	}

	private indexNodes(graph: Graph): void {
		for (const node of graph.nodes) this.nodesById.set(node.id, node);
	}

	/**
	 * Find the authored handler for `eventName`, seed the trigger + context scope, and run. Two
	 * possible entries, in order: (1) a dedicated `event` node whose `ref === eventName` (walk its
	 * `exec` out-pin); (2) failing that, the single `gameSignals` node — if the vocab has a NON-INTENT
	 * event named `eventName`, walk FROM that node's exec-out pin named `eventName` (the show-node
	 * pattern: continue from the pin's wired target, the source node is not re-run). No handler for
	 * `eventName` in either → parity-safe no-op.
	 */
	async runEvent(
		eventName: string,
		payload: Record<string, unknown>,
		context: Record<string, unknown>,
	): Promise<void> {
		const entry = this.doc.graph.nodes.find((n) => n.kind === 'event' && n.ref === eventName);
		if (entry) {
			await this.execFrom(this.doc.graph, entry.id, 'exec', { trigger: payload, context });
			return;
		}

		// Fall back to the `gameSignals` node's exec-out pin named `eventName` (book + lifecycle only —
		// an intent event is never a gameSignals pin, so it stays a no-op here).
		const signals = this.doc.graph.nodes.find((n) => n.kind === 'gameSignals');
		if (!signals) return; // no authored handler → parity-safe no-op.
		const surfaced = this.ctx.vocab.events.find(
			(e) => e.name === eventName && e.category !== 'intent',
		);
		if (!surfaced) return; // not a surfaced signal → parity-safe no-op.
		await this.runExecChain(this.doc.graph, signals.id, eventName, { trigger: payload, context });
	}

	/**
	 * Fire a container's component event (the FUSED exec-out pin on a `showContainer` node). The
	 * pin's decl id is `<componentId>.on<Event>`; find the authored exec edge FROM that pin on a
	 * `showContainer` node and walk from the edge's TARGET — the show node is NOT re-run (re-running
	 * it would re-mount the container). No wired edge → parity-safe no-op (the coded press runs).
	 */
	async runContainerEvent(
		componentId: string,
		event: string,
		payload: Record<string, unknown>,
		context: Record<string, unknown>,
	): Promise<void> {
		const declId = containerEventDeclId(componentId, event);
		const edge = this.doc.graph.exec.find(
			(e) => e.from.pin === declId && this.nodesById.get(e.from.node)?.kind === 'showContainer',
		);
		if (!edge) return; // no authored handler for this container-event pin → parity-safe no-op.
		await this.execFrom(this.doc.graph, edge.to.node, edge.to.pin, {
			trigger: payload,
			context,
		});
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

			case 'gameSignals':
				// An exec START point (a mechanic-signal SOURCE): `runEvent` walks FROM its per-event
				// exec-out pin, never re-running it as a mid-chain node. An accidental visit is a
				// safe no-op (it has no single canonical `exec` out-pin to continue from).
				return undefined;

			case 'action':
				await this.ctx.env.effect(node.ref, this.resolvePayload(graph, node, scope));
				return this.nextExec(graph, node.id, 'exec');

			case 'fireCue': {
				// AWAIT the cue's subscribers only when the node opts in (`await: true`), matching the
				// coded handlers' `broadcast` (fire-and-forget) vs `broadcastAsync` (awaited) split. A
				// fire-and-forget cue still triggers its subscribers; the flow just doesn't block.
				const done = this.ctx.env.broadcast(node.ref, this.resolvePayload(graph, node, scope));
				if (node.await) await done;
				return this.nextExec(graph, node.id, 'exec');
			}

			case 'delay': {
				const ms = this.resolveDelayMs(graph, node, scope);
				const scale = this.ctx.env.timeScale() || 1;
				await this.ctx.env.waitForTimeout(ms / scale);
				return this.nextExec(graph, node.id, 'exec');
			}

			case 'showContainer': {
				await this.ctx.env.showContainer(node.ref, this.zOf(node.ref));
				// ROUND-BLOCK HOLD: when the show node opts in, block the chain until this container next
				// completes (its `complete:<id>` → `hideContainer`, i.e. a tap on a `tapToContinue` overlay).
				// A recorder env without the hook resolves immediately (headless never deadlocks).
				if (node.awaitComplete) await this.ctx.env.awaitContainerComplete?.(node.ref);
				return this.nextExec(graph, node.id, 'exec');
			}

			case 'hideContainer': {
				await this.ctx.env.hideContainer(node.ref);
				return this.nextExec(graph, node.id, 'exec');
			}

			case 'textMessage': {
				// `hide` inlet clears the flow-shown flag; `show` raises it and — if `autoHideMs` is set —
				// schedules a turbo-scaled auto-clear that does NOT block the chain (the message flashes
				// while the round proceeds). Both inlets continue from the single `exec` out-pin.
				if (execPinId === 'hide') {
					this.ctx.env.setMessageShown?.(node.id, false);
				} else {
					this.ctx.env.setMessageShown?.(node.id, true);
					if (node.autoHideMs && node.autoHideMs > 0) {
						const scale = this.ctx.env.timeScale() || 1;
						void this.ctx.env
							.waitForTimeout(node.autoHideMs / scale)
							.then(() => this.ctx.env.setMessageShown?.(node.id, false));
					}
				}
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

			case 'group':
				// §5.2: groups are FLATTENED away in the ctor, so the walk never reaches one. An
				// accidental visit is a safe no-op (exhaustiveness for the Node union).
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
		// The GROUP-FLATTENED body (§5.2), indexed once in the ctor (falls back to the raw body).
		const body = this.fnBodies.get(fn.id) ?? fn.body;

		// Build the input map from the FunctionDef's declared data inputs, resolved in the
		// caller's scope (a wired data-in pulls its edge; else the call node's own DataSource).
		const input: Record<string, unknown> = {};
		for (const pin of fn.inputs) {
			if (pin.kind !== 'data') continue;
			input[pin.id] = this.resolveDataIn(graph, node.id, pin.id, scope);
		}

		const bodyScope: Scope = { trigger: scope.trigger, context: scope.context, input };
		const entry = body.nodes.find((n) => n.kind === 'functionEntry' && n.ref === fn.id);
		if (entry) await this.execFrom(body, entry.id, 'exec', bodyScope);

		// Capture the outputs from the body's functionResult data-ins.
		const result = body.nodes.find((n) => n.kind === 'functionResult' && n.ref === fn.id);
		const outputs: Record<string, unknown> = {};
		if (result) {
			for (const pin of fn.outputs) {
				if (pin.kind !== 'data') continue;
				outputs[pin.id] = this.resolveDataIn(body, result.id, pin.id, bodyScope);
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

	/**
	 * A Delay's hold in ms, FAIL-SAFE for a wired `ms`. A measurable wire (finite, > 0 — e.g. a
	 * `showContainer.durationMs` that resolved a real animation length) wins. But when the pin CAN'T
	 * measure — the asset isn't loaded, a clip name doesn't match, the scene has no animated node, or
	 * an OLDER runtime doesn't know the pin at all — it yields `0`/`NaN`; feeding that straight to the
	 * timer collapses the hold to 0 and tears the shown screen down the instant it mounts (the "Spine
	 * and FX stopped playing" footgun). So an unmeasurable wire falls back to the node's OWN authored
	 * literal `ms` (the author's floor). An UNWIRED Delay is unchanged — it already reads that literal.
	 * Final guard: a non-finite/negative result is `0`.
	 */
	private resolveDelayMs(graph: Graph, node: DelayNode, scope: Scope): number {
		const edge = graph.data.find((e) => e.to.node === node.id && e.to.pin === 'ms');
		if (edge) {
			const wired = Number(this.resolveDataOut(graph, edge.from, scope));
			if (Number.isFinite(wired) && wired > 0) return wired;
		}
		const src = node.inputs?.ms;
		const literal = src === undefined ? NaN : Number(this.resolveDataSource(src, scope));
		return Number.isFinite(literal) && literal >= 0 ? literal : 0;
	}

	/** Resolve the value produced at a data-OUT `(srcNode, srcPin)`. */
	private resolveDataOut(graph: Graph, from: PinPath, scope: Scope): unknown {
		const src = this.nodesById.get(from.node);
		if (!src) return undefined;
		switch (src.kind) {
			case 'event':
				// An event data-out IS the payload field named by the pin id.
				return scope.trigger[from.pin];
			case 'gameSignals': {
				// A gameSignals data-out pin is `<eventName>.<field>`; since only the firing event's exec
				// chain runs, `scope.trigger` IS that event's payload — resolve the field after the FIRST
				// `.` (a field name never contains a `.`; the event name might, so split once).
				const dot = from.pin.indexOf('.');
				if (dot === -1) return undefined;
				return scope.trigger[from.pin.slice(dot + 1)];
			}
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
			case 'showContainer': {
				// The `durationMs` data-out: the backing scene's longest animation in wall-clock ms,
				// computed by the injected env (containerId → scene → max over its animated nodes). A
				// recorder env without the hook resolves it to 0 (headless never depends on loaded assets).
				if (from.pin === 'durationMs') return this.ctx.env.containerAnimationMs?.(src.ref) ?? 0;
				// Otherwise a container-event payload data-out (`<componentId>.on<Event>.<field>`, e.g. a
				// repeater's `onSelect.betModeKey`): read `<field>` from the fired event's trigger payload.
				// Only ONE container-event chain runs at a time, so `scope.trigger` IS that event's payload
				// (`{ betModeKey: key }`). The field is the tail after the last `.` (field names carry none).
				return scope.trigger[from.pin.slice(from.pin.lastIndexOf('.') + 1)];
			}
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
			case 'trigger':
				// No member → the WHOLE event payload (e.g. a mechanic effect that consumes the raw
				// book event); a member → that payload field.
				return acc.member === undefined ? scope.trigger : scope.trigger[acc.member];
			case 'context':
				return acc.member === undefined ? scope.context : scope.context[acc.member];
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
	context: Record<string, unknown> = {},
): Promise<void> => {
	const interpreter = new FlowInterpreter(doc, ctx);
	await interpreter.runEvent(eventName, payload, context);
};

/**
 * Run the authored handler for a container's component event (`<componentId>` firing `<event>`).
 * Entry is the FUSED exec-out pin on a `showContainer` node — the interpreter walks FROM the pin's
 * wired target, without re-running the show node. If no exec edge is wired from that pin, it is a
 * no-op (parity-safe: an un-authored press falls through to the coded handler). Mirrors `runFlowEvent`.
 */
export const runFlowContainerEvent = async (
	doc: FlowDoc,
	ctx: RunContext,
	componentId: string,
	event: string,
	payload: Record<string, unknown> = {},
	context: Record<string, unknown> = {},
): Promise<void> => {
	const interpreter = new FlowInterpreter(doc, ctx);
	await interpreter.runContainerEvent(componentId, event, payload, context);
};

/**
 * PURE ownership predicate — true iff the FlowDoc wires an exec edge FROM a `showContainer` node's
 * fused pin for `<componentId>.on<Event>`. The game (Part 2) calls this to SUPPRESS the coded press
 * when the flow owns it, so the two never double-fire. No env/ctx needed — a static graph read.
 */
export const flowOwnsContainerEvent = (
	doc: FlowDoc,
	componentId: string,
	event: string,
): boolean => {
	const declId = containerEventDeclId(componentId, event);
	const nodesById = new Map(doc.graph.nodes.map((n) => [n.id, n] as const));
	return doc.graph.exec.some(
		(e) => e.from.pin === declId && nodesById.get(e.from.node)?.kind === 'showContainer',
	);
};

/**
 * PURE ownership predicate — true iff the FlowDoc wires an exec edge FROM a `gameSignals` node's
 * exec-out pin named `eventName`. The `gameSignals` node surfaces ALL book+lifecycle events, but
 * the author only WIRES some; ownership must be gated on the signal being wired, else an UNWIRED
 * signal would suppress its coded handler and drop the event. The game (Part 2) calls this to
 * SUPPRESS the coded handler ONLY for wired signals, so the two never double-fire. Mirrors
 * `flowOwnsContainerEvent`'s shape — no env/ctx needed, a static graph read.
 */
export const flowOwnsSignal = (doc: FlowDoc, eventName: string): boolean => {
	const nodesById = new Map(doc.graph.nodes.map((n) => [n.id, n] as const));
	return doc.graph.exec.some(
		(e) => e.from.pin === eventName && nodesById.get(e.from.node)?.kind === 'gameSignals',
	);
};

/**
 * Lifecycle signals that MOUNT SCREENS. They only take effect when the flow DRIVES SCREENS (i.e. it
 * owns `load`, so `flowV2DrivesScreens` is true and the mount model's shown set becomes the active
 * screen set). A flow that owns one of these WITHOUT owning `load` cannot mount the screen it points
 * at — yet its ownership still SUPPRESSES the coded lifecycle path — which is the "half-on" dead
 * state that silently hides the game (e.g. the basegame board / reel never mounts). Book events are
 * deliberately NOT here: they present OVER whatever screen is mounted (driven or coded), so their
 * ownership is always safe.
 */
export const SCREEN_LIFECYCLE_SIGNALS: ReadonlySet<string> = new Set(['load', 'tapToStart']);

/** A FlowDoc's screen-driving posture — see {@link flowScreenDrivingStatus}. */
export interface FlowScreenDrivingStatus {
	/** The flow authors the `load` entry (an `event` node with `ref: 'load'` OR a wired `gameSignals`
	 *  `load` exec pin) ⇒ it is the SOLE screen renderer (`flowV2DrivesScreens`). */
	drivesScreens: boolean;
	/** The flow has `showContainer`/`hideContainer` nodes ⇒ it INTENDS to mount/unmount screens. */
	hasContainerNodes: boolean;
	/** HALF-ON: screen-driving intent (container nodes) but it does NOT own `load`, so it cannot
	 *  actually mount screens while its ownership suppresses the coded path — the dead state a game
	 *  must guard against. */
	halfOn: boolean;
}

/**
 * Classify a FlowDoc's screen-driving posture (a pure graph read). `halfOn` is the dangerous state
 * an engine must guard: `showContainer`/`hideContainer` nodes are present (so the author intends to
 * drive screens) but the flow does NOT own `load` (so `flowV2DrivesScreens` is false and those
 * container shows never reach the active screen set). Owning `tapToStart` ALONE (e.g. to unlock
 * audio) is deliberately NOT half-on — only a container node signals an intent to MOUNT a screen, so
 * a purely audio/book-event flow that happens to wire `tapToStart` is never flagged.
 */
export const flowScreenDrivingStatus = (doc: FlowDoc): FlowScreenDrivingStatus => {
	const drivesScreens =
		doc.graph.nodes.some((n) => n.kind === 'event' && n.ref === 'load') ||
		flowOwnsSignal(doc, 'load');
	const hasContainerNodes = doc.graph.nodes.some(
		(n) => n.kind === 'showContainer' || n.kind === 'hideContainer',
	);
	return { drivesScreens, hasContainerNodes, halfOn: !drivesScreens && hasContainerNodes };
};

/**
 * PURE graph read — the set of container ids that some `showContainer{awaitComplete}` node targets,
 * i.e. the containers that CAN register a round-block hold. The mount model uses this to SCOPE its
 * order-independent completion latch: a `complete(id)` that arrives before its hold is registered is
 * only latched for one of these declared targets, so a persistent container (basegame/hudBar — never
 * an await target) is never spuriously latched and a later `awaitComplete` on it can't pre-resolve.
 */
export const awaitCompleteContainerIds = (doc: FlowDoc): Set<ContainerId> => {
	const ids = new Set<ContainerId>();
	for (const node of doc.graph.nodes) {
		if (node.kind === 'showContainer' && node.awaitComplete) ids.add(node.ref);
	}
	return ids;
};
