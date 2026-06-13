import type { ContainerNode, TemplateSlot } from './types';

/**
 * Anchor node for a `mount` slot: a container tagged with the slot + its
 * `bind.component`. Defaults to a zeroed origin (the seeder's behaviour); the
 * editor's "Add anchor" passes `init` to drop it as a visible box (e.g. over the
 * board frame) so the author can see + reposition it on the canvas.
 */
export function mountAnchor(
	sceneId: string,
	slot: TemplateSlot,
	init?: { x?: number; y?: number; width?: number; height?: number },
): ContainerNode {
	const node: ContainerNode = {
		id: `anchor_${sceneId}_${slot.slotId}`,
		label: slot.name || slot.slotId,
		kind: 'container',
		slotId: slot.slotId,
		x: init?.x ?? 0,
		y: init?.y ?? 0,
		children: [],
	};
	if (init?.width !== undefined) node.width = init.width;
	if (init?.height !== undefined) node.height = init.height;
	if (slot.mountComponent) node.bind = { component: slot.mountComponent };
	return node;
}
