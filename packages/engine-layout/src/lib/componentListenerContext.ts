import { getContext, setContext } from 'svelte';

import type { PointerAt, PointerPoint } from './componentPointer';
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

export interface ComponentListen {
	/** Is this node one of the instance's own? Only those become hit surfaces. */
	owns(nodeId: string): boolean;
	listen(node: LayoutNode, event: NodeListenerEvent, at?: PointerAt): void;
	/** A stage point in the instance's space (its root's), where a listener's pointer reads. */
	local(global: PointerPoint): PointerPoint;
}

export function setComponentListen(listen: ComponentListen): void {
	setContext(NS, listen);
}

export function getComponentListen(): ComponentListen | undefined {
	return getContext(NS);
}

/**
 * ALIGN TARGET (game-families §3.2, P10.4): the nodes of the instance's def that an Align Target
 * listener moves. Each such node, at init, hands the instance its parent's mapping and its own
 * position, and reads back where the pointer put it. Provided only when a listener of the def
 * aligns something; every other node never asks (parity).
 */
const ALIGN_NS = '@@engine_layout_component_align';

export interface ComponentAlignTarget {
	toLocal(global: PointerPoint): PointerPoint;
	position(): PointerPoint;
}

export interface ComponentAlign {
	targets(nodeId: string): boolean;
	/** Register the target; the getter is where the pointer placed it (reactive; an axis no Align
	 *  Target moved is absent). */
	attach(nodeId: string, target: ComponentAlignTarget): () => Partial<PointerPoint> | undefined;
	/** The target node is gone: an Align Target no longer reaches it (only if it is still this
	 *  registration — a remount may have attached a new one). */
	detach(nodeId: string, target: ComponentAlignTarget): void;
}

export function setComponentAlign(align: ComponentAlign): void {
	setContext(ALIGN_NS, align);
}

export function getComponentAlign(): ComponentAlign | undefined {
	return getContext(ALIGN_NS);
}
