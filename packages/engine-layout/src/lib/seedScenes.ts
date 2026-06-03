import type { ContainerNode, GameTemplate, Scene, TemplateSlot } from './types';

/**
 * Seed a project's editor scenes from a game type's template (§7.1/§7.2): one
 * `Scene` per `TemplateScene`. Artist-owned slots (`sprite`/`spine`/`text`) stay
 * unfilled — they need the project's own asset — but `mount` slots are
 * engine-owned, so their anchor `ContainerNode` (carrying `slotId` +
 * `bind.component`) is dropped immediately, exactly as the importer would (§7.2).
 * Without a template the result is empty, matching a blank doc.
 *
 * Pure + isomorphic: shared by the launcher's project scaffold, the in-editor
 * "Load game structure" action, and any future importer, so they never diverge.
 */
export function seedScenesFromTemplate(template: GameTemplate | undefined): Scene[] {
	if (!template) return [];
	return template.scenes.map((scene) => ({
		id: scene.id,
		name: scene.name,
		nodes: scene.slots
			.filter((slot) => slot.kind === 'mount')
			.map((slot) => mountAnchor(scene.id, slot)),
	}));
}

/** Anchor node for a `mount` slot: a zeroed container tagged with the slot. */
function mountAnchor(sceneId: string, slot: TemplateSlot): ContainerNode {
	const node: ContainerNode = {
		id: `anchor_${sceneId}_${slot.slotId}`,
		label: slot.name || slot.slotId,
		kind: 'container',
		slotId: slot.slotId,
		x: 0,
		y: 0,
		children: [],
	};
	if (slot.mountComponent) node.bind = { component: slot.mountComponent };
	return node;
}
