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
 * `transitionWipe` def carrying the coded node's own transform. The coded part drew at the canvas
 * centre INSIDE the node's wrapper (placed at the node's x / y / scale / rotation / alpha, per
 * layout through `overrides`), and the instance's rig cover-fits the canvas inside the instance the
 * same way, so carrying the transform keeps a moved or per-layout-adjusted Transition where it was.
 * The reference layouts keep the node at the origin, so there the two are the same point.
 */
const authoredTransitionNode = (coded: LayoutNode): LayoutNode => ({
	id: coded.id,
	...(coded.slotId ? { slotId: coded.slotId } : {}),
	label: 'Transition (authored)',
	kind: 'componentInstance',
	componentId: TRANSITION_WIPE_COMPONENT_ID,
	x: coded.x,
	y: coded.y,
	...(coded.scale !== undefined ? { scale: coded.scale } : {}),
	...(coded.rotation !== undefined ? { rotation: coded.rotation } : {}),
	...(coded.alpha !== undefined ? { alpha: coded.alpha } : {}),
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

/** The scene the game falls back to for the overlays when a doc carries none; it binds the wipe. */
export const OVERLAYS_SCENE_ID = 'basegameOverlays';

/**
 * Whether the game, rendering `doc`, has a coded Transition to swap: one in any of its scenes, or
 * no `basegameOverlays` scene of its own (the game then mounts its reference overlays scene, which
 * binds one). The ONE predicate the runtime swap and the publish chip share, so they never disagree.
 */
export function docHasCodedTransition(doc: Pick<LayoutDoc, 'scenes'>): boolean {
	return (
		!doc.scenes.some((scene) => scene.id === OVERLAYS_SCENE_ID) ||
		hasCodedTransition(doc.scenes.flatMap((scene) => scene.nodes))
	);
}

/**
 * A scene with every coded `bind: Transition` node swapped for the authored instance, wherever it
 * sits. No such node ⇒ the SAME scene object (nothing to swap).
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

/**
 * The doc with the swap applied to EVERY scene (the game applies it once, when the doc loads, so
 * each mount path renders the authored wipe). A doc with no coded Transition ⇒ the SAME doc object.
 */
export function withAuthoredTransitionDoc<T extends Pick<LayoutDoc, 'scenes'>>(doc: T): T {
	const scenes = doc.scenes.map(withAuthoredTransition);
	return scenes.some((scene, i) => scene !== doc.scenes[i]) ? { ...doc, scenes } : doc;
}
