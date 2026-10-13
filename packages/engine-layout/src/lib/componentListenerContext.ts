import { getContext, setContext } from 'svelte';

import type { LayoutNode, NodeListenerEvent } from './types';

/**
 * Component-listener context (Rive plan Phase 6): routes a pointer event on a node carrying `on`
 * listeners to its owning instance's dispatcher (`componentEvents.ts`). `<ComponentInstance>`
 * provides it only when some node of its def has listeners, and answers only for its own def's
 * nodes — a layout tree a coded part renders inside it is not its to answer. A node with no
 * provider (a top-level scene node) or no listeners stays inert (parity). Mirrors
 * `componentActionsContext`.
 */
const NS = '@@engine_layout_component_listen';

export type ComponentListen = (node: LayoutNode, event: NodeListenerEvent) => void;

export function setComponentListen(listen: ComponentListen): void {
	setContext(NS, listen);
}

export function getComponentListen(): ComponentListen | undefined {
	return getContext(NS);
}
