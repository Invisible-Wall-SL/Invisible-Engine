import { setContext, getContext } from 'svelte';

/**
 * Param context for `componentInstance` expansion (§13.2 "param threading").
 * `<ComponentInstance>` resolves an instance's effective params (def defaults ◁
 * project defaults ◁ instance overrides) and provides them here; nodes inside the
 * rendered `def.root` read them via {@link getComponentParams} to resolve their
 * {@link import('./types').BaseNode.paramBindings}. Mirrors
 * `componentInstanceContext`. No provider (a top-level scene node) ⇒ `{}`, so
 * bindings resolve to nothing and the node renders its static value (parity).
 */
const NS = '@@engine_layout_component_params';

export function setComponentParams(params: Record<string, unknown>): void {
	setContext(NS, params);
}

export function getComponentParams(): Record<string, unknown> {
	return getContext(NS) ?? {};
}
