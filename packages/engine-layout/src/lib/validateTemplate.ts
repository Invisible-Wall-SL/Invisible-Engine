import type { GameTemplate, LayoutDoc, LayoutNode, SlotKind } from './types';

/** A required template slot that no node in the matching scene fills. */
export interface UnfilledSlot {
	sceneId: string;
	slotId: string;
	name: string;
	kind: SlotKind;
}

/** Collect every `slotId` used by a node tree (recursing into containers). */
function collectSlotIds(nodes: LayoutNode[], into: Set<string>): void {
	for (const node of nodes) {
		if (node.slotId) into.add(node.slotId);
		if (node.kind === 'container') collectSlotIds(node.children, into);
	}
}

/**
 * The template's `required` slots that the doc leaves unfilled — i.e. no node in
 * the matching scene carries that `slotId`. This is the save-time validation
 * behind "slot `boardFrame` empty" (see `docs/design/invisible-editor.md`
 * §7.1); it warns, it does not block saving. A scene the doc omits entirely
 * counts all its required slots as unfilled.
 */
export function findUnfilledRequiredSlots(doc: LayoutDoc, template: GameTemplate): UnfilledSlot[] {
	const unfilled: UnfilledSlot[] = [];
	for (const scene of template.scenes) {
		const filled = new Set<string>();
		const docScene = doc.scenes.find((candidate) => candidate.id === scene.id);
		if (docScene) collectSlotIds(docScene.nodes, filled);
		for (const slot of scene.slots) {
			if (slot.required && !filled.has(slot.slotId)) {
				unfilled.push({
					sceneId: scene.id,
					slotId: slot.slotId,
					name: slot.name,
					kind: slot.kind,
				});
			}
		}
	}
	return unfilled;
}
