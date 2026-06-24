import type { FlowAccessor, FlowGuard, FlowPayload, FlowValue } from './types';

/** The execution scope an accessor resolves against — the triggering book event payload,
 *  (inside a `forEach`) the current item, and an optional reader for registered engine
 *  value feeds (`$engine.*`). Bounded by design (design doc §11.4). */
export type FlowScope = {
	trigger: unknown;
	item?: unknown;
	/** The per-event dispatch context (`{ bookEvents }`) — the sibling of the trigger payload
	 *  the coded handler's second argument carries. Read via `$context.*` (e.g.
	 *  `$context.bookEvents`), so an effect that needs the surrounding book list (a reveal's
	 *  multiple-reveal check, the resume snapshot) can resolve it without leaving the bounded
	 *  accessor model. Absent in pure-choreography / transition contexts (⇒ `undefined`). */
	context?: unknown;
	/** Read a registered engine value feed by `ENGINE_PARAM_CATALOG` key (`$engine.*`).
	 *  Injected by the interpreter; absent in pure-choreography contexts (⇒ `undefined`). */
	engine?: (key: string) => unknown;
};

const readPath = (root: unknown, path: string): unknown => {
	if (path === '') return root;
	let current: unknown = root;
	for (const segment of path.split('.')) {
		if (current == null) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
};

/** Resolve a single whitelisted accessor against the scope. No arbitrary expressions —
 *  only literals and `$trigger.*` / `$item.*` path reads (design doc §11.4). */
export const resolveAccessor = (accessor: FlowAccessor, scope: FlowScope): unknown => {
	switch (accessor.kind) {
		case 'literal':
			return accessor.value;
		case 'trigger':
			return readPath(scope.trigger, accessor.path);
		case 'item':
			return readPath(scope.item, accessor.path);
		case 'context':
			return readPath(scope.context, accessor.path);
		case 'engine':
			return scope.engine ? scope.engine(accessor.key) : undefined;
	}
};

/** Evaluate one bounded guard (an AND of comparison predicates) against the scope — the
 *  closed comparison set, NOT an expression language (design doc §11.4). An empty/absent
 *  guard is vacuously true (an unconditional edge / Branch). */
export const evaluateGuard = (guard: FlowGuard | undefined, scope: FlowScope): boolean => {
	if (!guard) return true;
	return guard.all.every((predicate) => {
		const left = resolveAccessor(predicate.left, scope);
		const right = resolveAccessor(predicate.right, scope);
		switch (predicate.op) {
			case 'eq':
				return left === right;
			case 'neq':
				return left !== right;
			case 'gt':
				return (left as number) > (right as number);
			case 'gte':
				return (left as number) >= (right as number);
			case 'lt':
				return (left as number) < (right as number);
			case 'lte':
				return (left as number) <= (right as number);
			case 'in':
				return Array.isArray(right) && right.includes(left);
		}
	});
};

/** Build an emitter payload object from an authored `FlowPayload`, merged onto `{ type }`. */
export const resolvePayload = (
	type: string,
	payload: FlowPayload | undefined,
	scope: FlowScope,
): { type: string } & Record<string, unknown> => {
	const result: { type: string } & Record<string, unknown> = { type };
	if (payload) {
		for (const key of Object.keys(payload)) {
			result[key] = resolveAccessor(payload[key], scope);
		}
	}
	return result;
};

/** Resolve a `FlowPayload` to a plain value map (no `{ type }` merge) — the resolved
 *  argument an `effect` node hands its registered game-side implementation. Absent ⇒ `{}`. */
export const resolvePayloadValues = (
	payload: FlowPayload | undefined,
	scope: FlowScope,
): Record<string, unknown> => {
	const result: Record<string, unknown> = {};
	if (payload) {
		for (const key of Object.keys(payload)) {
			result[key] = resolveAccessor(payload[key], scope);
		}
	}
	return result;
};

/** Resolve an accessor expected to yield a list (for `forEach`). Non-arrays ⇒ empty. */
export const resolveList = (accessor: FlowAccessor, scope: FlowScope): unknown[] => {
	const value = resolveAccessor(accessor, scope);
	return Array.isArray(value) ? value : [];
};

export type { FlowValue };
