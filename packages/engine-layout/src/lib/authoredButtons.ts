import { BUTTON_PRESENTATION_ID } from './builtinComponents';
import type { ComponentDef, ComponentInstanceNode, LayoutDoc, LayoutNode, Scene } from './types';

/**
 * THE AUTHORED BUTTON, doc side (Rive plan Phase 8d, `docs/design/rive-style-editor.md` §13.8.6):
 * the per-project switch `settings.authoredOverlays.buttons`, the ONE status rule the game and the
 * launcher's chips share, and the pure swap the game applies once to the loaded doc. Svelte-free,
 * so the gate drives exactly what `Game.svelte` runs. Off, or held back ⇒ the doc and every scene
 * are returned AS IS (the same objects).
 */

export const BUTTON_COMPONENT_ID = 'button';

/** Whether the doc draws its parametric buttons from the authored `buttonPresentation`. */
export const authoredButtonsEnabled = (doc: Pick<LayoutDoc, 'settings'>): boolean =>
	doc.settings?.authoredOverlays?.buttons === true;

const isButtonInstance = (node: LayoutNode): node is ComponentInstanceNode =>
	node.kind === 'componentInstance' && node.componentId === BUTTON_COMPONENT_ID;

const some = (nodes: readonly LayoutNode[], test: (node: LayoutNode) => boolean): boolean =>
	nodes.some((node) => test(node) || (node.kind === 'container' && some(node.children, test)));

/** Whether any scene of the doc places a `button` instance, at any depth. */
export const docHasButtonInstance = (doc: Pick<LayoutDoc, 'scenes'>): boolean =>
	doc.scenes.some((scene) => some(scene.nodes, isButtonInstance));

const plainPart = (node: LayoutNode | undefined, component: string): boolean =>
	!!node &&
	node.kind === 'container' &&
	node.bind?.component === component &&
	!Object.keys(node.bind.props ?? {}).length &&
	!node.children.length &&
	!node.x &&
	!node.y &&
	(!node.anchor || (node.anchor.x === 0.5 && node.anchor.y === 0.5)) &&
	node.scale === undefined &&
	node.rotation === undefined &&
	node.alpha === undefined &&
	!node.overrides &&
	!node.paramBindings &&
	!node.on;

/**
 * Whether the `button` def a game resolves draws what the built-in does — its root the bare
 * `ButtonFrame` and `ButtonLabel` parts and nothing else — so `buttonPresentation` reproduces it. A
 * publish bakes the built-in's copy (possibly an older version with fewer params, which draws the
 * same); a project's own `button` (an extra node, bind props on the frame, a moved label) does not
 * pass. No def at all ⇒ the built-in is what renders.
 */
export function isBuiltinButtonShape(def: ComponentDef | undefined): boolean {
	if (!def) return true;
	const root = def.root;
	if (root.kind !== 'container' || root.children.length !== 2) return false;
	if (root.x || root.y || root.scale !== undefined || root.rotation !== undefined) return false;
	return plainPart(root.children[0], 'ButtonFrame') && plainPart(root.children[1], 'ButtonLabel');
}

/**
 * What the flag does to a doc:
 * - `off` — the flag is off;
 * - `ready` — the game swaps every `button` instance;
 * - `nothing-to-replace` — no scene places a `button` instance (the coded `UiButton*` binds of the
 *   editor default and Book of Borut are another path, untouched);
 * - `custom-button` — the project's own baked defs shadow `button` (a custom frame or bind props the
 *   authored def does not draw).
 * Every held-back status keeps the coded frame for EVERY button, and the publish chip warns.
 */
export type AuthoredButtonsStatus = 'off' | 'ready' | 'nothing-to-replace' | 'custom-button';

export function authoredButtonsStatus(
	doc: Pick<LayoutDoc, 'settings' | 'scenes'>,
	options: { shadowed?: boolean } = {},
): AuthoredButtonsStatus {
	if (!authoredButtonsEnabled(doc)) return 'off';
	if (!docHasButtonInstance(doc)) return 'nothing-to-replace';
	if (options.shadowed) return 'custom-button';
	return 'ready';
}

/**
 * The authored stand-in for a `button` instance: the same node — transform, per-layout overrides,
 * params, slot, visibility, everything — naming `buttonPresentation`, whose params are `button`'s.
 * A pinned `componentVersion` named a `button` version, so it is dropped (the new def is v1).
 */
const authoredButtonNode = (node: ComponentInstanceNode): ComponentInstanceNode => {
	const { componentVersion: _pinned, ...rest } = node;
	return { ...rest, componentId: BUTTON_PRESENTATION_ID };
};

/** A scene with every `button` instance swapped; none ⇒ the SAME scene object. */
export function withAuthoredButtons(scene: Scene): Scene {
	let swapped = false;
	const rewrite = (node: LayoutNode): LayoutNode => {
		if (isButtonInstance(node)) {
			swapped = true;
			return authoredButtonNode(node);
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

/** The doc with the button swap applied to EVERY scene; nothing to swap ⇒ the SAME doc object. */
export function withAuthoredButtonsDoc<T extends Pick<LayoutDoc, 'scenes'>>(doc: T): T {
	const scenes = doc.scenes.map(withAuthoredButtons);
	return scenes.some((scene, i) => scene !== doc.scenes[i]) ? { ...doc, scenes } : doc;
}
