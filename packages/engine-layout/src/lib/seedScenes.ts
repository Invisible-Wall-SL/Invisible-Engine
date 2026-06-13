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
 *
 * @deprecated Superseded by `engineOwnedOnly` (§19) as the scaffold source — a
 * new project now seeds from `engineOwnedOnly(referenceLayout(gameType))`, the
 * engine-owned projection of the one real composition, instead of this parallel
 * empty-`GameTemplate` scene list. Kept for back-compat.
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
