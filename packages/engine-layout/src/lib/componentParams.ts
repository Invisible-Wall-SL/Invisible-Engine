import type { ComponentDef, ComponentInstanceNode, LayoutNode, LayoutType } from './types';

/**
 * Resolve a `componentInstance`'s effective params (§13.2 "param threading").
 * Merge precedence, low → high:
 *
 *   `def.params[i].default` (keyed by `.key`, when defined)
 *     ◁ `def.defaultInstanceParams` (the def's per-instance seed defaults, e.g. the
 *        Loading Bar's `tapToContinue: true` — SHARED overlay params NOT declared in
 *        `def.params`; see below)
 *     ◁ `projectDefaults` (the per-project component-defaults store, B3 — passed
 *        `undefined` by B1 callers)
 *     ◁ `instanceParams` (the {@link ComponentInstanceNode.params} overrides)
 *
 * `defaultInstanceParams` used to be applied ONLY when the editor DROPPED an instance
 * (written into `node.params`), NOT here — so a HAND-AUTHORED instance (a reference-layout
 * scaffold node, or any project seeded from one) never received it. That silently disabled
 * `LOADING_BAR_DEF`'s loading gate on every scaffolded/existing project, so a driven flow
 * stranded on the loading screen. Applying it here makes it a true RUNTIME default (its
 * documented intent — "the bar IS a flow-driven loading gate out of the box"), overridable by
 * a project default or an explicit instance param (clearing a toggle writes an explicit
 * `false`, which wins over the seed). Because a seed is invisible in a hand-authored doc, the
 * Scene Editor's instance panel shows the EFFECTIVE value (seed included), never the raw param.
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
	mergeDefined(out, def.defaultInstanceParams);
	mergeDefined(out, projectDefaults);
	mergeDefined(out, instanceParams);
	return out;
}

/**
 * A componentInstance's effective BASE params for a layoutType — the instance's own
 * {@link ComponentInstanceNode.params} with the per-layoutType {@link NodeOverride.params}
 * patch merged on top. The per-ratio-override analogue of `resolveTransform`, kept as its
 * own step so it composes with {@link resolveComponentParams} (def defaults ◁ project
 * defaults ◁ THIS) rather than duplicating that precedence.
 *
 * Returns `node.params` UNCHANGED (same reference) when there's no override for this
 * layoutType, so a doc that authored no per-ratio param is byte-identical to today (parity).
 * Used by the editor canvas (which resolves params synchronously per active layoutType); the
 * runtime `<ComponentInstance>` overlays the same override reactively (per-key getters) so it
 * re-resolves when the device rotates without re-running the init-stable structural reads.
 * Pure + Svelte-free so both surfaces share one merge.
 */
export function resolveLayoutInstanceParams(
	node: ComponentInstanceNode,
	layoutType: LayoutType,
): Record<string, unknown> | undefined {
	const override = node.overrides?.[layoutType]?.params;
	if (!override) return node.params;
	const out: Record<string, unknown> = { ...node.params };
	mergeDefined(out, override);
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

/**
 * The keys of a component's params that drive a FONT — so the editor renders them
 * as a font dropdown (matching a text node's font field) instead of a free-text box.
 * A param is a font when ANY of:
 *  1. a text node binds its `style.fontFamily` to that param key (the "Expose text
 *     as params" flow + manual Font binds), OR
 *  2. its key is the engine's canonical font key `fontFamily` (a coded component —
 *     e.g. the HUD Readout — declares its font as `{ key: 'fontFamily', kind: 'font' }`
 *     in the bound-component catalog; `ComponentParam` has no `'font'` kind, so it is
 *     stored as a plain `string` and would otherwise miss the binding-only check), OR
 *  3. its `label` is `font` (the grouped label the expose flow stamps on the font param).
 * Pure + Svelte-free so both editors share one definition.
 */
export function fontParamKeysOf(def: ComponentDef | null | undefined): Set<string> {
	const set = new Set<string>();
	if (!def) return set;
	const walk = (n: LayoutNode): void => {
		if (n.kind === 'text') {
			const key = n.paramBindings?.['style.fontFamily'];
			if (key) set.add(key);
		} else if (n.kind === 'container') {
			for (const child of n.children) walk(child);
		}
	};
	walk(def.root);
	for (const p of def.params ?? []) {
		if (p.kind === 'string' && (p.key === 'fontFamily' || p.label === 'font')) set.add(p.key);
	}
	return set;
}

/**
 * Drop node `paramBindings` entries that reference a param key NOT declared in
 * `def.params` — an "orphan" binding, left behind when a param is deleted while a
 * node still binds a field to it (the bound field then silently can't be edited per
 * instance, because the param no longer exists to render a control). Mutates the
 * def's node tree in place; returns `true` if anything was removed. A binding to a
 * missing param is inert at runtime (`resolveBoundValue` finds nothing and the field
 * keeps its static value), so pruning it is loss-free and restores a clean,
 * self-consistent def. Pure + Svelte-free — shared by the editors + the save/load
 * normalizer so the invariant "no binding without its param" holds everywhere.
 */
export function pruneOrphanParamBindings(def: ComponentDef): boolean {
	const valid = new Set((def.params ?? []).map((p) => p.key));
	let changed = false;
	const walk = (n: LayoutNode): void => {
		if (n.paramBindings) {
			const next: Record<string, string> = {};
			for (const [field, key] of Object.entries(n.paramBindings)) {
				if (valid.has(key)) next[field] = key;
				else changed = true;
			}
			n.paramBindings = Object.keys(next).length ? next : undefined;
		}
		if (n.kind === 'container') for (const child of n.children) walk(child);
	};
	walk(def.root);
	return changed;
}
