/**
 * Engine instance-value registry — the NODE-ID-keyed engineProvided-values feed. It maps a scene
 * `componentInstance`'s NODE id (not its `componentId`) to the game's live map of `engineProvided`
 * param values (`title`/`message`/… for the confirm dialog). Sibling to `registerComponentValues`
 * (single `value` feed, keyed by SOURCE name) and `registerRepeaterSources` (list feed): the game
 * registers the source once at boot, and the ONE scene instance whose NODE id matches binds to it.
 *
 * Why node-id-keyed, not component-id-keyed: a MOUNT-supplied instance (`<Repeater>` prop /
 * `<ConfirmDialog>` instance-binding context) can't reach a scene instance shown GENERICALLY by the
 * Flow interpreter (`showContainer(buyConfirm)` walks the scene tree — no prop, no binding context),
 * so its `engineProvided` params fall back to the def defaults. This feed is the third, LOWEST-
 * precedence supplier `<ComponentInstance>` consults (prop ?? binding ?? THIS ?? def default), so a
 * flow-shown instance renders the game's live per-mode copy. Keying by NODE id — not component id —
 * scopes the values to the ONE placed instance (the seeded `confirm-dialog` node in the `buyConfirm`
 * scene), so a second, unrelated `confirmDialog` placed elsewhere is untouched (it never registers a
 * source under its own node id). A different scene that copies the same node id would collide, but
 * node id is the tightest key the render-time seam exposes — far tighter than the component id.
 *
 * Module-scoped (private to whichever bundled copy of this package the game pulls in — pnpm gives
 * each game its own copy, so no cross-game leakage). Svelte-free: a source is the bare Svelte-store
 * `subscribe` contract, so this module is re-exported from the type-only `engine-layout` entry.
 * No source registered for a node ⇒ `getInstanceValueSource` is `undefined` ⇒ the instance keeps its
 * prop/binding/def values (parity — byte-identical to today).
 */

/**
 * Minimal Svelte-store contract an instance-value source must satisfy — the map sibling of
 * `ValueSource`, kept to bare `subscribe` so this module stays Svelte-free. `subscribe` MUST invoke
 * `run` synchronously with the current values on subscribe (the Svelte store contract), so the first
 * paint has a real map.
 */
export interface InstanceValueSource {
	subscribe(run: (values: Record<string, unknown>) => void): () => void;
}

const registry = new Map<string, InstanceValueSource>();

export function registerInstanceValues(sources: Record<string, InstanceValueSource>): void {
	for (const [nodeId, source] of Object.entries(sources)) {
		registry.set(nodeId, source);
	}
}

export function getInstanceValueSource(nodeId: string): InstanceValueSource | undefined {
	return registry.get(nodeId);
}

export function clearInstanceValues(): void {
	registry.clear();
}
