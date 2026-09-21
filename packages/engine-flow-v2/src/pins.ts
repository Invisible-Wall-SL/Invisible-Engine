/**
 * Invisible Flow v2 — pin derivation (schema §2, §3, the ANTI-DRIFT rule). A node stores
 * only a REFERENCE (an event/action/function name); its pins are DERIVED here from that
 * reference + the `TemplateVocabulary` (+ `FunctionLibraryDoc` for a functionCall). Nothing
 * calls back into stored pins, so a node's pins can never disagree with the effect it calls.
 *
 * The per-kind derivation mirrors §3 exactly:
 *  - event         — out `exec`; one data-out per the `EventDecl` payload.
 *  - action        — in `exec`, out `exec`; one data-in per the `ActionDecl` param.
 *  - fireCue       — in `exec`, out `exec`; data-ins only if the cue declares a payload.
 *  - delay         — in `exec`, out `exec`, in `ms: ms`.
 *  - branch        — in `exec`; the guard's operand data-ins; out `then`, out `else`.
 *  - forEach       — in `exec`, in `in: list<T>`; out `body`, out `item: T`, out `index: int`,
 *                    out `done`.
 *  - showContainer — in `exec`, out `exec`, + one exec-out per the container's configured component
 *                    event (§6.1, keyed by ContainerId in `PinContext.containerEvents`); hideContainer
 *                    — in `exec`, out `exec`.
 *  - functionCall  — the target `FunctionDef`'s declared `inputs` / `outputs`, verbatim.
 *  - sequence / parallel — in `exec`; N ordered/concurrent out execs `then[0..count-1]`.
 *  - compute       — no exec; one data-out `out` whose type follows the op + operands.
 */

import type {
	Accessor,
	ComputeOp,
	ContainerEventDecl,
	DataSource,
	FunctionDef,
	FunctionLibraryDoc,
	Guard,
	Node,
	ParamDecl,
	Pin,
	TemplateVocabulary,
	TypeRef,
} from './types';

/** The lookups a deriver (and the validator, which runs on the same context) needs — the template
 *  contract, the shared function library, and the scene-backed facts about each container. */
export interface PinContext {
	vocab: TemplateVocabulary;
	library: FunctionLibraryDoc;
	/**
	 * §6.1 — container-scoped component events, keyed by `ContainerId` (a `showContainer` node's `ref`)
	 * → its aggregated decls (`deriveContainerEvents`). When supplied, the referenced `showContainer`
	 * node FUSES one exec-out per decl onto itself (mount + all its buttons in one node), keyed by the
	 * decl's `id`. Absent for a ref ⇒ that `showContainer` derives just `[exec-in, exec-out]`
	 * (parity-safe).
	 */
	containerEvents?: Record<string, ContainerEventDecl[]>;
	/**
	 * RESOLVED release surfaces, keyed by `ContainerId` → does that container's backing scene mount
	 * something that can COMPLETE it (a `tapToContinue` overlay, or a `completeOnLoaded` auto-advance)?
	 * Both call the game's `completeActiveScreen` → `mount.complete(id)`, which is what releases a
	 * `showContainer{awaitComplete}` hold.
	 *
	 * Read by the validator only (`hold-without-release` / `tap-without-hold`) — no pin's shape depends
	 * on it. It lives here because it is the same kind of lookup as `containerEvents`: a fact about the
	 * SCENE behind a container, which the FlowDoc alone cannot answer, projected in by whoever holds the
	 * LayoutDoc.
	 *
	 * NEVER GUESS (`scope.ts`): a container is keyed here ONLY when its scene actually resolved. An
	 * absent key means "unknown", and every check that reads this map is skipped for it — so an unsaved
	 * or standalone project (empty map) yields NO issues rather than a false error on every flow.
	 */
	containerTaps?: Record<string, boolean>;
}

const EXEC_IN: Pin = { id: 'exec', dir: 'in', kind: 'exec' };
const EXEC_OUT: Pin = { id: 'exec', dir: 'out', kind: 'exec' };

const dataIn = (
	id: string,
	dataType: TypeRef,
	label?: string,
	doc?: string,
	optional?: boolean,
): Pin => ({
	id,
	dir: 'in',
	kind: 'data',
	dataType,
	label,
	doc,
	optional,
});

/** A vocab param (an action's/cue's declared field) → its data-in pin. Carries the decl's
 *  `description` and `optional` through, so the editor tooltip + the validator's required-ness both
 *  follow the vocabulary rather than being re-stated per node (§2, anti-drift). */
const paramIn = (p: ParamDecl): Pin => dataIn(p.name, p.type, p.name, p.description, p.optional);

const dataOut = (id: string, dataType: TypeRef, label?: string, doc?: string): Pin => ({
	id,
	dir: 'out',
	kind: 'data',
	dataType,
	label,
	doc,
});

const execOut = (id: string, label?: string, doc?: string): Pin => ({
	id,
	dir: 'out',
	kind: 'exec',
	label,
	doc,
});

const capitalize = (s: string): string =>
	s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);

/** The `gameSignals` exec-out pin's LABEL — the `on<Event>` tail (mirrors `containerEventPinLabel`). */
const signalPinLabel = (eventName: string): string => `on${capitalize(eventName)}`;

// ---------------------------------------------------------------------------
// Scope resolution — the element type a `forEach` iterates + accessor typing. These
// let `compute`/`guard` pins recover the type of a `$item`/`$index`/`$engine` read.
// ---------------------------------------------------------------------------

/** The declared struct fields of a struct type, or `undefined` if unknown. */
const structFieldType = (
	ctx: PinContext,
	structName: string,
	member: string,
): TypeRef | undefined =>
	ctx.vocab.structs.find((s) => s.name === structName)?.fields.find((f) => f.name === member)?.type;

/**
 * Best-effort static type of a `DataSource` used as a `compute`/`guard`/`delay` operand.
 * A `wire` source is typed by its incoming data edge (not visible here), so it resolves to
 * `undefined`; a `literal` carries its own type; an `accessor` is typed against the vocab.
 * `scopeItem` is the element type of the enclosing forEach, when one exists.
 */
export const dataSourceType = (
	ctx: PinContext,
	src: DataSource,
	scopeItem?: TypeRef,
): TypeRef | undefined => {
	if (src.kind === 'wire') return undefined;
	if (src.kind === 'literal') return src.type;
	return accessorType(ctx, src.path, scopeItem);
};

const accessorType = (ctx: PinContext, acc: Accessor, scopeItem?: TypeRef): TypeRef | undefined => {
	switch (acc.on) {
		case 'index':
			return { t: 'int' };
		case 'item': {
			if (!scopeItem) return undefined;
			if (acc.member === undefined) return scopeItem;
			if (scopeItem.t !== 'struct') return undefined;
			return structFieldType(ctx, scopeItem.name, acc.member);
		}
		case 'engine': {
			const coll = ctx.vocab.collections.find((c) => c.name === acc.key);
			return coll ? { t: 'list', of: coll.of } : undefined;
		}
		case 'input':
			// A function input's type is only known inside a function body (the entry node's
			// outputs); the top-level deriver has no such scope, so it is left unresolved here.
			return undefined;
	}
};

/** The output type of a `compute` op, given its operands' types (best-effort). */
export const computeOutType = (ctx: PinContext, op: ComputeOp): TypeRef | undefined => {
	if (op.op === 'member') {
		const on = dataSourceType(ctx, op.on);
		if (on?.t !== 'struct') return undefined;
		return structFieldType(ctx, on.name, op.member);
	}
	// Arithmetic: int unless an operand is a float (then float). `ms` counts as int.
	const a = dataSourceType(ctx, op.a);
	const b = dataSourceType(ctx, op.b);
	const isFloat = (t?: TypeRef) => t?.t === 'float';
	if (isFloat(a) || isFloat(b)) return { t: 'float' };
	return { t: 'int' };
};

// ---------------------------------------------------------------------------
// The operand data-ins a `guard` exposes — one `left`/`right` per compare, but only for
// operands sourced by `wire` (a literal/accessor operand needs no pin). Ids are stable
// by position: `all.0.left`, `any.1.right`, ….
// ---------------------------------------------------------------------------

const guardPins = (guard: Guard): Pin[] => {
	const pins: Pin[] = [];
	const add = (group: 'all' | 'any', idx: number, side: 'left' | 'right', src: DataSource) => {
		if (src.kind !== 'wire') return; // literal/accessor operands are inline, not pins.
		pins.push({ id: `${group}.${idx}.${side}`, dir: 'in', kind: 'data' });
	};
	(guard.all ?? []).forEach((c, i) => {
		add('all', i, 'left', c.left);
		add('all', i, 'right', c.right);
	});
	(guard.any ?? []).forEach((c, i) => {
		add('any', i, 'left', c.left);
		add('any', i, 'right', c.right);
	});
	return pins;
};

// ---------------------------------------------------------------------------
// `derivePins` — the one entry point. `scope` carries the two facts a node's pins can
// depend on that are NOT readable from the node itself (`deriveGraphPins`, `scope.ts`,
// resolves both from the graph and threads them in).
// ---------------------------------------------------------------------------

/**
 * The graph-derived facts a node's pin types may depend on. A node stores only its own ref +
 * `inputs`, so a deriver can see neither the loop it sits in nor the edges feeding it; the graph
 * pass (`deriveGraphPins`) resolves both and passes them here. An empty scope is always safe: a
 * pin whose type needs it is simply emitted untyped (the pre-scope behaviour).
 */
export interface PinScope {
	/** The element type of the enclosing forEach, when the node sits inside a loop body. */
	item?: TypeRef;
	/** The resolved types of the node's data-ins that are fed by a data EDGE, keyed by pin id.
	 *  Only `forEach.in` consumes one today (to type `item` when the list arrives by wire). */
	wiredIns?: Record<string, TypeRef>;
}

export const derivePins = (node: Node, ctx: PinContext, scope: PinScope = {}): Pin[] => {
	switch (node.kind) {
		case 'event': {
			const decl = ctx.vocab.events.find((e) => e.name === node.ref);
			const outs = (decl?.payload ?? []).map((p) => dataOut(p.name, p.type, p.name, p.description));
			// The entry exec-out carries the event's own help (what it is / when it fires).
			const start: Pin = { ...EXEC_OUT, doc: decl?.description };
			return [start, ...outs]; // entry point: NO exec-in.
		}
		case 'gameSignals': {
			// §6.2: the ONE mechanic-signal source node. Derives, for each vocab event whose category is
			// NOT `intent` (book + lifecycle; intents are the container button pins, §6.1): one exec-out
			// (id = event name, label = `on<Event>`) + one data-out per that event's payload field (id =
			// `<eventName>.<field>`). NO exec-in — it is a source/entry node. Anti-drift: derived from the
			// vocabulary, never stored. An untagged event defaults to `book` → surfaced.
			const pins: Pin[] = [];
			for (const e of ctx.vocab.events) {
				if (e.category === 'intent') continue;
				pins.push(execOut(e.name, signalPinLabel(e.name), e.description));
				for (const p of e.payload)
					pins.push(dataOut(`${e.name}.${p.name}`, p.type, p.name, p.description));
			}
			return pins;
		}
		case 'action': {
			const decl = ctx.vocab.actions.find((a) => a.name === node.ref);
			const ins = (decl?.params ?? []).map(paramIn);
			return [EXEC_IN, EXEC_OUT, ...ins];
		}
		case 'fireCue': {
			const decl = ctx.vocab.cues.find((c) => c.name === node.ref);
			const ins = (decl?.payload ?? []).map(paramIn);
			return [EXEC_IN, EXEC_OUT, ...ins];
		}
		case 'delay':
			return [EXEC_IN, EXEC_OUT, dataIn('ms', { t: 'ms' }, 'ms')];
		case 'branch':
			return [EXEC_IN, execOut('then'), execOut('else'), ...guardPins(node.guard)];
		case 'forEach': {
			// The iterated collection's element type. An incoming data EDGE on `in` WINS over the node's
			// own `inputs.in` — that is the runtime's precedence (`resolveDataIn` reads the edge first),
			// so the pin must be typed by the same rule. No edge ⇒ type the node's own literal/accessor
			// source. Neither resolvable ⇒ `item`/`in` fall back to untyped.
			const inSource = node.inputs?.in;
			const listType =
				scope.wiredIns?.in ?? (inSource ? dataSourceType(ctx, inSource, scope.item) : undefined);
			const elem = listType?.t === 'list' ? listType.of : undefined;
			const item: Pin = elem
				? dataOut('item', elem, 'item')
				: { id: 'item', dir: 'out', kind: 'data', label: 'item' };
			const inPin: Pin = listType
				? dataIn('in', listType, 'in')
				: { id: 'in', dir: 'in', kind: 'data', label: 'in' };
			return [
				EXEC_IN,
				inPin,
				execOut('body'),
				item,
				dataOut('index', { t: 'int' }, 'index'),
				execOut('done'),
			];
		}
		case 'showContainer': {
			// §6.1: the fused model — the container's configured component events surface as exec-out pins
			// ON THIS NODE (mount + all its buttons in one node), keyed by ContainerId. Each decl's `id`
			// is the (node-unique) pin id; its `label` (`onSpin`) is the pin caption. Absent surface ⇒
			// just `[exec-in, exec-out]` (parity-safe).
			const events = ctx.containerEvents?.[node.ref] ?? [];
			const eventOuts = events.map(
				(d) => ({ id: d.id, dir: 'out', kind: 'exec', label: d.label }) as Pin,
			);
			// A container event may carry a PAYLOAD (e.g. a `repeater`'s `onSelect` → `betModeKey`): surface
			// each field as a typed data-out ON THIS NODE, id `<decl.id>.<field>` (node-unique, mirroring
			// `gameSignals`' `<eventName>.<field>`). The runtime resolves it from the fired event's trigger
			// payload. An event with no payload (every button) adds nothing ⇒ parity-safe.
			const eventDataOuts = events.flatMap((d) =>
				(d.payload ?? []).map((p) => dataOut(`${d.id}.${p.name}`, p.type, p.name, p.description)),
			);
			// A `durationMs` data-out: the backing scene's longest animation, in wall-clock ms (max over its
			// spine/effect nodes), resolved by the runtime env. Wire it into a Delay's `ms` to hold for
			// exactly the screen's animation instead of a guessed literal.
			const durationOut = dataOut(
				'durationMs',
				{ t: 'ms' },
				'Animation duration (ms)',
				"This screen's longest animation, in wall-clock ms (the max over its spine/effect nodes). " +
					'Wire into a Delay to hold for exactly that long. 0 when nothing measurable is mounted yet.',
			);
			return [EXEC_IN, EXEC_OUT, ...eventOuts, ...eventDataOuts, durationOut];
		}
		case 'hideContainer':
			return [EXEC_IN, EXEC_OUT];
		case 'textMessage':
			// Two exec-INS — `show` (raise the flow-shown flag + arm autoHide) and `hide` (clear it) —
			// plus ONE exec-out `exec` that continues from whichever inlet fired, so the node chains
			// (e.g. onSpin → show → …). Both inlets are OPTIONAL: a purely state-gated message
			// (`visibleWhile`) wires neither. No data pins — the text lives on the node (§6.3).
			return [
				{ id: 'show', dir: 'in', kind: 'exec', label: 'Show' },
				{ id: 'hide', dir: 'in', kind: 'exec', label: 'Hide' },
				EXEC_OUT,
			];
		case 'playCinematic':
			// `play` starts it from the top, `stop` cuts it short; ONE exec-out continues from
			// whichever inlet fired. `stop` is optional — most cinematics run to their own end. No
			// data pins: which cinematic, whether it loops and how fast all live on the node, and
			// everything else about it was authored in /rigger.
			return [
				{ id: 'play', dir: 'in', kind: 'exec', label: 'Play' },
				{ id: 'stop', dir: 'in', kind: 'exec', label: 'Stop' },
				EXEC_OUT,
			];
		case 'functionCall': {
			const fn: FunctionDef | undefined = ctx.library.functions.find((f) => f.id === node.ref);
			// The call node's pins ARE the function's declared inputs/outputs, verbatim (§5).
			return fn ? [...fn.inputs, ...fn.outputs] : [];
		}
		case 'sequence':
		case 'parallel': {
			const outs = Array.from({ length: Math.max(0, node.count) }, (_, i) => execOut(`then[${i}]`));
			return [EXEC_IN, ...outs];
		}
		case 'compute': {
			const outType = computeOutType(ctx, node.compute);
			const out: Pin = outType
				? dataOut('out', outType, 'out')
				: { id: 'out', dir: 'out', kind: 'data', label: 'out' };
			return [out]; // pure value op: NO exec pins.
		}
		case 'group':
			// §5.2: a group's pins are STORED on `boundary` (the deliberate exception to derivation —
			// the boundary IS the group's definition), so map them verbatim to `Pin[]`.
			return node.boundary.map((b) => ({
				id: b.id,
				dir: b.dir,
				kind: b.kind,
				dataType: b.dataType,
				label: b.label,
			}));
		case 'functionEntry': {
			// The body reads the function's inputs by pulling from the entry's OUTPUTS:
			// exec-OUT + one data-OUT per the FunctionDef's declared data input (§5). If `ref`
			// doesn't resolve, only the exec pin is derivable.
			const fn: FunctionDef | undefined = ctx.library.functions.find((f) => f.id === node.ref);
			if (!fn) return [EXEC_OUT];
			const outs = fn.inputs
				.filter((p) => p.kind === 'data')
				.map((p) => dataOut(p.id, p.dataType!, p.label));
			return [EXEC_OUT, ...outs];
		}
		case 'functionResult': {
			// The result collects the function's outputs: exec-IN + one data-IN per the
			// FunctionDef's declared data output (§5). If `ref` doesn't resolve, only exec.
			const fn: FunctionDef | undefined = ctx.library.functions.find((f) => f.id === node.ref);
			if (!fn) return [EXEC_IN];
			const ins = fn.outputs
				.filter((p) => p.kind === 'data')
				.map((p) => dataIn(p.id, p.dataType!, p.label));
			return [EXEC_IN, ...ins];
		}
	}
};
