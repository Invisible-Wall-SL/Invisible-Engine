import { setContext, getContext } from 'svelte';

/**
 * Per-instance BINDING context — the way a canvas-takeover MOUNT (e.g. `<ConfirmDialog>`) supplies
 * a scene-placed `componentInstance` with runtime values + press callbacks a static scene node can't
 * carry. Keyed by `componentId`: the mount sets `{ <id>: { engineValues, actions } }` on its own
 * context, and the matching `<ComponentInstance>` rendered inside the mount's `<LayoutScene>` reads
 * its entry (via {@link getInstanceBinding}) as the FALLBACK for its `engineValues`/`actions` props.
 * This is the single-instance sibling of the `<Repeater>` path (which passes the same data as PROPS
 * because it CREATES each instance directly). No provider (a normal game scene) ⇒ `undefined` ⇒ the
 * instance uses its own props / static params (parity — byte-identical to today).
 */
const NS = '@@engine_layout_instance_bindings';

export type InstanceBinding = {
	/** Per-instance `engineProvided` param values (title/message/…), threaded into the param context. */
	engineValues?: Record<string, unknown>;
	/** Named press handlers a `pressAction` node routes to (e.g. `{ confirm, cancel }`). */
	actions?: Record<string, () => void>;
};

export function setInstanceBindings(bindings: Record<string, InstanceBinding>): void {
	setContext(NS, bindings);
}

export function getInstanceBinding(componentId: string): InstanceBinding | undefined {
	return getContext<Record<string, InstanceBinding> | undefined>(NS)?.[componentId];
}
