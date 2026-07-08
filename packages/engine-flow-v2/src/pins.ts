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
	Pin,
	TemplateVocabulary,
	TypeRef,
} from './types';

/** The lookups a deriver needs — the template contract + the shared function library. */
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
}

const EXEC_IN: Pin = { id: 'exec', dir: 'in', kind: 'exec' };
const EXEC_OUT: Pin = { id: 'exec', dir: 'out', kind: 'exec' };

const dataIn = (id: string, dataType: TypeRef, label?: string): Pin => ({
	id,
	dir: 'in',
	kind: 'data',
	dataType,
	label,
});

const dataOut = (id: string, dataType: TypeRef, label?: string): Pin => ({
	id,
	dir: 'out',
	kind: 'data',
	dataType,
	label,
});

const execOut = (id: string, label?: string): Pin => ({ id, dir: 'out', kind: 'exec', label });

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
// `derivePins` — the one entry point. `scopeItem` is the element type of the enclosing
// forEach when the node sits inside a loop body (needed to type a forEach-nested reference).
// ---------------------------------------------------------------------------

export const derivePins = (node: Node, ctx: PinContext, scopeItem?: TypeRef): Pin[] => {
	switch (node.kind) {
		case 'event': {
			const decl = ctx.vocab.events.find((e) => e.name === node.ref);
			const outs = (decl?.payload ?? []).map((p) => dataOut(p.name, p.type, p.name));
			return [EXEC_OUT, ...outs]; // entry point: NO exec-in.
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
				pins.push(execOut(e.name, signalPinLabel(e.name)));
				for (const p of e.payload) pins.push(dataOut(`${e.name}.${p.name}`, p.type, p.name));
			}
			return pins;
		}
		case 'action': {
			const decl = ctx.vocab.actions.find((a) => a.name === node.ref);
			const ins = (decl?.params ?? []).map((p) => dataIn(p.name, p.type, p.name));
			return [EXEC_IN, EXEC_OUT, ...ins];
		}
		case 'fireCue': {
			const decl = ctx.vocab.cues.find((c) => c.name === node.ref);
			const ins = (decl?.payload ?? []).map((p) => dataIn(p.name, p.type, p.name));
			return [EXEC_IN, EXEC_OUT, ...ins];
		}
		case 'delay':
			return [EXEC_IN, EXEC_OUT, dataIn('ms', { t: 'ms' }, 'ms')];
		case 'branch':
			return [EXEC_IN, execOut('then'), execOut('else'), ...guardPins(node.guard)];
		case 'forEach': {
			// The iterated collection's element type: taken from the wired `in` source when it is a
			// literal/accessor list; otherwise `item`/`index` fall back to untyped `item` + int.
			const inSource = node.inputs?.in;
			const listType = inSource ? dataSourceType(ctx, inSource, scopeItem) : undefined;
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
			return [EXEC_IN, EXEC_OUT, ...eventOuts];
		}
		case 'hideContainer':
			return [EXEC_IN, EXEC_OUT];
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
