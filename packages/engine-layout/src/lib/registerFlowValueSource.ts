/**
 * Flow value-source resolver registry (design doc `flow-driven-game.md` §11.4) — the runtime sink
 * `<ComponentInstance>` calls to resolve a value display's engine FEED NAME through the Flow
 * interpreter's authored value-binding overrides, WITHOUT engine-layout importing the game's Flow
 * holder (the `declare ≠ implement` split). It is the value-dataflow sibling of `registerFlowComplete`:
 * the game registers its holder's `resolveValueSource` once at boot, and `<ComponentInstance>` passes
 * a display's `(node.id, source)` through it before `getComponentValueSource`, so an authored value
 * edge redirects which registered `ValueSource` store the display subscribes to — a subscription
 * override, never a copy (§11.2 rule 1).
 *
 * Module-scoped (private to whichever bundled copy of this package the game pulls in — pnpm gives each
 * game its own copy, so no cross-game leakage) and Svelte-free, so this module is re-exported from the
 * bare `engine-layout` (type-only) entry. UNREGISTERED by default ⇒ `getFlowValueSource()` is
 * `undefined` ⇒ `<ComponentInstance>` falls back to the display's own `source` verbatim (parity §11.6),
 * exactly like the coded feed lookup today — byte-identical on a normal boot with no FlowDoc.
 */

/** Resolve a value display's engine feed name, honouring authored value-binding overrides. Returns
 *  the OVERRIDE producer feed key when a `value` edge rebinds `${instanceId}::${source}`, else the
 *  display's own `source` verbatim (the game wires this to the interpreter's `resolveValueSource`). */
export type FlowValueResolver = (instanceId: string, source: string) => string;

let registered: FlowValueResolver | undefined;

export function registerFlowValueSource(resolver: FlowValueResolver): void {
	registered = resolver;
}

export function getFlowValueSource(): FlowValueResolver | undefined {
	return registered;
}

export function clearFlowValueSource(): void {
	registered = undefined;
}
