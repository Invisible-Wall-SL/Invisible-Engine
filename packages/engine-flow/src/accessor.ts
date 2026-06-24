import type { FlowAccessor, FlowPayload, FlowValue } from './types';

/** The execution scope an accessor resolves against — the triggering book event payload
 *  and (inside a `forEach`) the current item. Bounded by design (design doc §11.4). */
export type FlowScope = {
	trigger: unknown;
	item?: unknown;
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
	}
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

/** Resolve an accessor expected to yield a list (for `forEach`). Non-arrays ⇒ empty. */
export const resolveList = (accessor: FlowAccessor, scope: FlowScope): unknown[] => {
	const value = resolveAccessor(accessor, scope);
	return Array.isArray(value) ? value : [];
};

export type { FlowValue };
