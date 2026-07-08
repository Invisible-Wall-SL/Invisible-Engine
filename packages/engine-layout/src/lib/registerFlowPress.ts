/**
 * Flow press resolver registry (design doc `invisible-flow-v2-schema.md`) — the runtime sink
 * `<ComponentInstance>` calls to route a button/container PRESS through the Flow v2 interpreter's
 * authored container-event chain, WITHOUT engine-layout importing the game's Flow holder (the
 * `declare ≠ implement` split). It is the behaviour sibling of `registerFlowValueSource`: the game
 * registers its holder's press resolver once at boot, and `<ComponentInstance>` consults it before
 * the coded `onpress` so an authored exec edge from a container's fused event pin OWNS the press —
 * firing the flow's wired chain (e.g. `startSpin` → the `invokeIntent` bridge) INSTEAD of the coded
 * body, so the two never double-fire (ownership SUPPRESSION, §Part 2).
 *
 * Module-scoped (private to whichever bundled copy of this package the game pulls in — pnpm gives each
 * game its own copy, so no cross-game leakage) and Svelte-free, so this module is re-exported from the
 * bare `engine-layout` (type-only) entry. UNREGISTERED by default ⇒ `getFlowPress()` is `undefined` ⇒
 * `<ComponentInstance>` falls back to the component's own coded `onpress` verbatim (parity), exactly
 * like the coded action lookup today — byte-identical on a normal boot with no v2 FlowDoc.
 */

/** Resolve a press handler for `(instanceId, action)`, honouring the flow's authored container-event
 *  ownership. Returns a press handler that routes to the flow WHEN the flow OWNS the event (an authored
 *  exec edge from that fused pin), else `undefined` so the caller runs its coded `onpress` unchanged
 *  (parity). The game wires this to the interpreter holder's `resolveFlowV2Press`. */
export type FlowPressResolver = (instanceId: string, action: string) => (() => void) | undefined;

let registered: FlowPressResolver | undefined;

export function registerFlowPress(resolver: FlowPressResolver): void {
	registered = resolver;
}

export function getFlowPress(): FlowPressResolver | undefined {
	return registered;
}

export function clearFlowPress(): void {
	registered = undefined;
}
