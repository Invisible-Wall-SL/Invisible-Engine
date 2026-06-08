import type { ComponentDef } from './types';

/**
 * Resolve a `componentInstance`'s effective params (§13.2 "param threading").
 * Merge precedence, low → high:
 *
 *   `def.params[i].default` (keyed by `.key`, when defined)
 *     ◁ `projectDefaults` (the per-project component-defaults store, B3 — passed
 *        `undefined` by B1 callers)
 *     ◁ `instanceParams` (the {@link ComponentInstanceNode.params} overrides)
 *
 * `undefined` values are SKIPPED at every layer, so a higher layer never erases a
 * lower default by carrying an explicit `undefined`. Pure + Svelte-free so both
 * the engine renderer and the editor canvas can reuse it.
 */
export function resolveComponentParams(
	def: ComponentDef,
	instanceParams?: Record<string, unknown>,
	projectDefaults?: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const param of def.params ?? []) {
		if (param.default !== undefined) {
			out[param.key] = param.default;
		}
	}
	mergeDefined(out, projectDefaults);
	mergeDefined(out, instanceParams);
	return out;
}

function mergeDefined(target: Record<string, unknown>, source?: Record<string, unknown>): void {
	if (!source) return;
	for (const [key, value] of Object.entries(source)) {
		if (value !== undefined) {
			target[key] = value;
		}
	}
}

/**
 * Look up the value a node FIELD PATH is bound to (§13.2). If
 * `paramBindings[fieldPath]` names a param key present in `params`, return that
 * value; otherwise `undefined` (the caller keeps its own static value). Pure — it
 * only walks the binding then the param map, never the node.
 */
export function resolveBoundValue(
	paramBindings: Record<string, string> | undefined,
	fieldPath: string,
	params: Record<string, unknown>,
): unknown {
	const paramKey = paramBindings?.[fieldPath];
	if (paramKey === undefined) return undefined;
	return params[paramKey];
}
