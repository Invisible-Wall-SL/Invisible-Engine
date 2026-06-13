import { isHudScene } from './referenceLayouts/hud';
import type { ContainerNode, LayoutDoc, LayoutNode, Scene } from './types';

/**
 * Project a filled, slot-tagged reference layout down to its engine-owned
 * scaffold (see `docs/design/invisible-editor.md` §19.3 / §19.4): the correct
 * screens + the engine-owned pieces (reel grid, HUD, overlay/loading/free-spin
 * anchors), with ALL plain artist art removed. This is the `scaffold`
 * projection — "create a game from a kind" gets the right screens + wired
 * engine pieces + no art — computed from the single reference-layout source so
 * nothing can drift (it is THE scaffold source, replacing the old parallel
 * empty-`GameTemplate` seeding).
 *
 * Pure: never mutates the input. Returns a fresh `LayoutDoc` preserving the
 * doc-level header verbatim; every input scene is still emitted (the screen
 * exists even when it ends up unfurnished).
 */
export function engineOwnedOnly(doc: LayoutDoc): LayoutDoc {
	return {
		...doc,
		scenes: doc.scenes.map(filterScene),
		mainSizesMap: { ...doc.mainSizesMap },
	};
}

function filterScene(scene: Scene): Scene {
	// The HUD layer is engine-owned wholesale — keep all of its nodes verbatim.
	if (isHudScene(scene)) {
		return { ...scene, nodes: scene.nodes.map(cloneNode) };
	}
	return { ...scene, nodes: filterNodes(scene.nodes) };
}

function filterNodes(nodes: LayoutNode[]): LayoutNode[] {
	const kept: LayoutNode[] = [];
	for (const node of nodes) {
		const filtered = filterNode(node);
		if (filtered) kept.push(filtered);
	}
	return kept;
}

/**
 * §19.4 classifier. KEEP a node iff it carries a `bind` (any kind — `bind`
 * lives on `BaseNode`, so it is the discriminator regardless of node kind), is
 * a `reelGrid`, or is a `componentInstance` (the engine-bound parametric HUD
 * readouts/buttons + freeSpinCounter). A `slotId` ALONE does not keep a node —
 * an artist board frame sprite has a `slotId` but no `bind`, so it drops.
 *
 * Otherwise: a plain `container` recurses (kept only if it still has surviving
 * children); a plain `sprite`/`spine`/`text` is artist art and is dropped.
 */
function filterNode(node: LayoutNode): LayoutNode | undefined {
	if (node.bind) return cloneNode(node);
	if (node.kind === 'reelGrid' || node.kind === 'componentInstance') return cloneNode(node);

	if (node.kind === 'container') {
		const children = filterNodes(node.children);
		if (children.length === 0) return undefined;
		const cloned = cloneNode(node) as ContainerNode;
		cloned.children = children;
		return cloned;
	}

	return undefined;
}

function cloneNode<T extends LayoutNode>(node: T): T {
	return structuredClone(node);
}
