import type { LayoutDoc, LayoutNode, Scene } from './types';

/**
 * AUTHORED OVERLAYS (Rive plan Phase 8a, `docs/design/rive-style-editor.md` §13.2): the per-project
 * switch that renders a coded overlay from its authored component, and the pure rewrite the game
 * applies to the `basegameOverlays` scene when it is on. Svelte-free, so the gate drives exactly
 * what `Game.svelte` runs.
 *
 * The flag is `settings.authoredOverlays.transition` on the layout doc — sparse, written only when
 * on, shipped inside the doc with the rest of the game's settings. Off, or absent, ⇒ the scene is
 * returned AS IS (the same object), so every doc authored before the flag renders byte-identically.
 * Lives here so the game (`Game.svelte`) and the launcher (the publish chips) read the one rule.
 */

export const TRANSITION_WIPE_COMPONENT_ID = 'transitionWipe';

/** Whether the doc renders the Transition from its authored component. */
export const authoredTransitionEnabled = (doc: Pick<LayoutDoc, 'settings'>): boolean =>
	doc.settings?.authoredOverlays?.transition === true;

const isCodedTransition = (node: LayoutNode): boolean => node.bind?.component === 'Transition';

/**
 * The authored stand-in for a coded `bind: Transition` node: an instance of the built-in
 * `transitionWipe` def at the scene origin. Its rig node cover-fits the canvas (centred, 1.7 × the
 * canvas height), so the instance carries no anchor and no offset — the coded part's placement.
 * The coded node's id, slot, z and layout gates (`visibleFor`, per-layout `overrides`) carry
 * over; its transform does not (the coded part ignored it too).
 */
const authoredTransitionNode = (coded: LayoutNode): LayoutNode => ({
	id: coded.id,
	...(coded.slotId ? { slotId: coded.slotId } : {}),
	label: 'Transition (authored)',
	kind: 'componentInstance',
	componentId: TRANSITION_WIPE_COMPONENT_ID,
	x: 0,
	y: 0,
	...(coded.zIndex !== undefined ? { zIndex: coded.zIndex } : {}),
	...(coded.visibleFor ? { visibleFor: coded.visibleFor } : {}),
	...(coded.overrides ? { overrides: coded.overrides } : {}),
	params: {},
});

/** Whether `nodes` holds a coded Transition bind, at any depth. */
export function hasCodedTransition(nodes: readonly LayoutNode[]): boolean {
	return nodes.some(
		(node) =>
			isCodedTransition(node) || (node.kind === 'container' && hasCodedTransition(node.children)),
	);
}

/**
 * The overlays scene with every coded `bind: Transition` node swapped for the authored instance,
 * wherever it sits. No such node ⇒ the SAME scene object (nothing to swap).
 */
export function withAuthoredTransition(scene: Scene): Scene {
	let swapped = false;
	const rewrite = (node: LayoutNode): LayoutNode => {
		if (isCodedTransition(node)) {
			swapped = true;
			return authoredTransitionNode(node);
		}
		if (node.kind === 'container') {
			const children = node.children.map(rewrite);
			return children.some((child, i) => child !== node.children[i]) ? { ...node, children } : node;
		}
		return node;
	};
	const nodes = scene.nodes.map(rewrite);
	return swapped ? { ...scene, nodes } : scene;
}
