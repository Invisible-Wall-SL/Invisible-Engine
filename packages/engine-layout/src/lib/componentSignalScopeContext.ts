import { getContext, setContext } from 'svelte';

/**
 * Signal-scope context (Phase 12a, `docs/design/hold-and-win.md` §8) — the scope a
 * `componentInstance` hears signals for, handed down its rendered sub-tree. `<ComponentInstance>`
 * resolves it from the param its def names (`ComponentDef.signalScope`) and provides it; a nested
 * instance with no scope of its own inherits it, and an effect node inside reads it to filter its
 * event-driven layers. No provider (a scene-level node) ⇒ `undefined` ⇒ unscoped: it hears every
 * fire, as before scopes existed.
 */
const NS = '@@engine_layout_component_signal_scope';

export function setComponentSignalScope(scope: string | undefined): void {
	setContext(NS, scope);
}

export function getComponentSignalScope(): string | undefined {
	return getContext(NS);
}
