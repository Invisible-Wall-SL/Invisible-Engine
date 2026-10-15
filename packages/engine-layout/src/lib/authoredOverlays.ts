import { WIN_PRESENTATION_DEFAULTS } from './builtinComponents';
import { WIN_PRESENTATION_COMPONENT_ID } from './builtinTimelines';
import type { LayoutDoc, LayoutNode, NodeOverride, Scene } from './types';
import {
	resolveWinText,
	resolveWinTextForMode,
	winTextHasVariable,
	type WinTextDoc,
} from './winText';

/**
 * AUTHORED OVERLAYS (Rive plan Phase 8a, `docs/design/rive-style-editor.md` §13.2): the per-project
 * switch that renders a coded overlay from its authored component, and the pure rewrite the game
 * applies ONCE to the whole loaded doc (every scene, and the reference overlays fallback) when it
 * is on. Svelte-free, so the gate drives exactly what `Game.svelte` runs.
 *
 * The flag is `settings.authoredOverlays.transition` on the layout doc — sparse, written only when
 * on, shipped inside the doc with the rest of the game's settings. Off, or absent, ⇒ the doc and
 * every scene are returned AS IS (the same objects), so every doc authored before the flag renders
 * byte-identically. `authoredTransitionStatus` is the ONE rule the game's flip and the launcher's
 * publish chips share, so the two never disagree.
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
	...(coded.anchor ? { anchor: coded.anchor } : {}),
	...(coded.screenAnchor ? { screenAnchor: coded.screenAnchor } : {}),
	...(coded.blendMode ? { blendMode: coded.blendMode } : {}),
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
 * binds one).
 */
export function docHasCodedTransition(doc: Pick<LayoutDoc, 'scenes'>): boolean {
	return (
		!doc.scenes.some((scene) => scene.id === OVERLAYS_SCENE_ID) ||
		hasCodedTransition(doc.scenes.flatMap((scene) => scene.nodes))
	);
}

/**
 * What the flag does to `doc`, the ONE rule the game and the launcher share:
 * - `off` — the flag is not on; the coded Transition renders.
 * - `ready` — the authored wipe replaces every coded Transition.
 * - `nothing-to-replace` — the flag is on, but no scene binds a coded Transition (and the doc has
 *   an overlays scene of its own, so the reference fallback does not bind one either): no wipe
 *   would play at all. The coded path stays; the chip warns.
 * - `non-canvas-scene` — the flag is on, but a coded Transition sits in a scene that is not
 *   `canvas` space (`game`, `standard`, `background`): the authored rig cover-fits only in a canvas
 *   scene, so the swap would move the wipe. The coded path stays everywhere; the chip warns.
 */
export type AuthoredTransitionStatus = 'off' | 'ready' | 'nothing-to-replace' | 'non-canvas-scene';

export function authoredTransitionStatus(
	doc: Pick<LayoutDoc, 'scenes' | 'settings'>,
): AuthoredTransitionStatus {
	if (!authoredTransitionEnabled(doc)) return 'off';
	if (!docHasCodedTransition(doc)) return 'nothing-to-replace';
	const holding = doc.scenes.filter((scene) => hasCodedTransition(scene.nodes));
	if (holding.some((scene) => (scene.space ?? 'game') !== 'canvas')) return 'non-canvas-scene';
	return 'ready';
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

// ---------------------------------------------------------------------------------------------
// THE AUTHORED WIN (Rive plan Phase 8b, §13.6.6): the same pattern, one flag row further. The
// scope line: what the coded `WinVisual` DRAWS becomes the built-in `winPresentation` instance and
// its generated per-tier timelines; the coded `WinGate` stays (count-up, round hold, presses, dim,
// `winState`) and conducts them.
// ---------------------------------------------------------------------------------------------

/** The `game`-space scene the split win overlay's visual lives in (`referenceLayouts/lines.ts`). */
export const WIN_VISUAL_SCENE_ID = 'winVisual';

/** Whether the doc renders the big-win presentation from its authored component. */
export const authoredWinEnabled = (doc: Pick<LayoutDoc, 'settings'>): boolean =>
	doc.settings?.authoredOverlays?.win === true;

const isCodedWinComposer = (node: LayoutNode): boolean => node.bind?.component === 'Win';
const isCodedWinGate = (node: LayoutNode): boolean =>
	isCodedWinComposer(node) || node.bind?.component === 'WinGate';
const isWinInstance = (node: LayoutNode): boolean =>
	node.kind === 'componentInstance' && node.componentId === 'win';
const isWinPresentationInstance = (node: LayoutNode): boolean =>
	node.kind === 'componentInstance' && node.componentId === WIN_PRESENTATION_COMPONENT_ID;

const some = (nodes: readonly LayoutNode[], test: (node: LayoutNode) => boolean): boolean =>
	nodes.some((node) => test(node) || (node.kind === 'container' && some(node.children, test)));

/** Whether `nodes` bind a coded `Win` / `WinGate`, at any depth. */
export const hasCodedWinGate = (nodes: readonly LayoutNode[]): boolean =>
	some(nodes, isCodedWinGate);
/** Whether `nodes` place a `win` instance (the hybrid twin), at any depth. */
export const hasWinInstance = (nodes: readonly LayoutNode[]): boolean => some(nodes, isWinInstance);
/** Whether `nodes` place a `winPresentation` instance (a doc already swapped), at any depth. */
export const hasWinPresentationInstance = (nodes: readonly LayoutNode[]): boolean =>
	some(nodes, isWinPresentationInstance);

/**
 * Whether the game, rendering `doc`, has a coded win presentation to replace: a coded `Win` /
 * `WinGate` bind or a placed `win` instance in any scene, or no `basegameOverlays` scene of its own
 * (the reference overlays scene it then mounts binds the composer).
 */
export function docHasCodedWin(doc: Pick<LayoutDoc, 'scenes'>): boolean {
	const nodes = doc.scenes.flatMap((scene) => scene.nodes);
	return (
		!doc.scenes.some((scene) => scene.id === OVERLAYS_SCENE_ID) ||
		hasCodedWinGate(nodes) ||
		hasWinInstance(nodes)
	);
}

/**
 * What the flag does to a project, the ONE rule the game and the launcher share:
 * - `off` — the flag is not on; the coded visual renders.
 * - `ready` — the authored presentation replaces the coded visual.
 * - `nothing-to-replace` — the flag is on, but no scene binds a coded `Win` / `WinGate`, none
 *   places a `win` instance, and the doc has an overlays scene of its own: no presentation would
 *   play at all. The coded path stays; the chip warns.
 * - `caption-variable` — an active tier's Win Text caption, in the base game or any spins mode,
 *   interpolates a resolver variable (`{amount}` …), which the authored text track cannot render.
 *   The coded path stays; the chip warns (the resolver variable is 8c's).
 * - `tier-presentation-unsupported` — the active tiers resolve to more than one rig bundle or
 *   count slot: the authored presentation has ONE rig node, so it cannot play them. The coded path
 *   stays; the chip warns.
 */
export type AuthoredWinStatus =
	'off' | 'ready' | 'nothing-to-replace' | 'caption-variable' | 'tier-presentation-unsupported';

/** One active big tier, as the game resolved its presentation — plain data, so the launcher can build it too. */
export interface AuthoredWinTier {
	alias: string;
	/** The tier's Win Text caption (`winLevels.<alias>`), when authored. */
	caption?: string;
	/** The spins modes whose own caption for the tier differs (mode id → caption, `''` ⇒ none). */
	modeCaptions?: Record<string, string>;
	/** The rig bundle the tier resolves to (`<alias>Spine` ?? the tier's `spineKey` ?? `winSpine`). */
	rigKey: string;
	/** The count slot the tier resolves to (`<alias>Slot` ?? `slotName`). */
	slotName: string;
}

/**
 * The spins modes that speak their own Win Text caption for tier `alias` — mode id → that mode's
 * caption (`''` ⇒ none), only where it differs from the base game's. What the coded caption reads
 * while a mode is on top (`boardWinText()` → `resolveWinTextForMode`); `undefined` when no mode
 * differs (every live doc).
 */
export function winTierModeCaptions(
	doc: WinTextDoc | undefined,
	alias: string,
): Record<string, string> | undefined {
	if (!doc?.modes) return undefined;
	const base = resolveWinText(doc).winLevels[alias] ?? '';
	const out: Record<string, string> = {};
	for (const mode of Object.keys(doc.modes)) {
		const caption = resolveWinTextForMode(doc, mode).winLevels[alias] ?? '';
		if (caption !== base) out[mode] = caption;
	}
	return Object.keys(out).length ? out : undefined;
}

export function authoredWinStatus(input: {
	doc: Pick<LayoutDoc, 'scenes' | 'settings'>;
	tiers: readonly AuthoredWinTier[];
}): AuthoredWinStatus {
	if (!authoredWinEnabled(input.doc)) return 'off';
	if (!docHasCodedWin(input.doc)) return 'nothing-to-replace';
	const captions = input.tiers.flatMap((tier) => [
		tier.caption,
		...Object.values(tier.modeCaptions ?? {}),
	]);
	if (captions.some((caption) => winTextHasVariable(caption))) return 'caption-variable';
	const rigs = new Set(input.tiers.map((tier) => tier.rigKey));
	const slots = new Set(input.tiers.map((tier) => tier.slotName));
	if (rigs.size > 1 || slots.size > 1) return 'tier-presentation-unsupported';
	return 'ready';
}

/**
 * The rig bundle and count slot every active tier resolves to (`authoredWinStatus` is `ready` only
 * when they all agree). The def's one `tier` node takes its rig from `winSpine` and the riders
 * their slot from `slotName`, so the swap writes these there: a tier rig named per tier
 * (`<alias>Spine`), by the config (`spineKey`) or a shared param all draw the rig the coded part did.
 */
export interface AuthoredWinPresentation {
	winSpine: string;
	slotName: string;
}

/** `params` with the resolved rig and slot written where they differ from what the def reads. */
const withPresentation = (
	params: Record<string, unknown> | undefined,
	presentation: AuthoredWinPresentation | undefined,
): Record<string, unknown> | undefined => {
	if (!presentation) return params;
	const patch: Record<string, unknown> = {};
	for (const key of ['winSpine', 'slotName'] as const) {
		const value = params?.[key];
		const reads =
			typeof value === 'string' && value.length > 0 ? value : WIN_PRESENTATION_DEFAULTS[key];
		if (reads !== presentation[key]) patch[key] = presentation[key];
	}
	return Object.keys(patch).length ? { ...(params ?? {}), ...patch } : params;
};

/**
 * A scene with the win swap applied, wherever it sits: every coded `bind: Win` composer becomes its
 * GATE half (`bind: WinGate` — the degrade the game already applied for a doc that placed its own
 * visual), and every placed `win` instance becomes a `winPresentation` instance carrying its
 * transform, overrides and params (the same keys), with the tiers' resolved rig and slot written in
 * (`presentation`). Nothing to swap ⇒ the SAME scene object.
 */
export function withAuthoredWin(scene: Scene, presentation?: AuthoredWinPresentation): Scene {
	let swapped = false;
	const rewrite = (node: LayoutNode): LayoutNode => {
		if (isCodedWinComposer(node) && node.bind) {
			swapped = true;
			return { ...node, bind: { ...node.bind, component: 'WinGate' } };
		}
		if (node.kind === 'componentInstance' && node.componentId === 'win') {
			swapped = true;
			const { componentVersion: _pinned, ...rest } = node;
			const params = withPresentation(node.params, presentation);
			return {
				...rest,
				componentId: WIN_PRESENTATION_COMPONENT_ID,
				...(params ? { params } : {}),
			};
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

type MainSizes = Record<string, { width: number; height: number } | undefined>;

/**
 * The `game`-space scene that places the authored presentation where the coded OFF composer drew:
 * the board centre, which without a reel-grid override is the main box's centre on every layout
 * type (`boardLayout()`), hence the per-layout overrides. Rendered by the existing `winVisual`
 * mount, so nothing new mounts. Params default the shared rig + slot the coded part hardcoded, and
 * `fitBoard` — the coded composer fitted its rig to the board width; a PLACED instance (swapped
 * above) never gets it, so it keeps the natural size the coded `win` instance rendered at.
 */
export function authoredWinVisualScene(
	mainSizesMap: MainSizes,
	presentation?: AuthoredWinPresentation,
): Scene {
	const centre = (size: { width: number; height: number } | undefined) =>
		size ? { x: size.width * 0.5, y: size.height * 0.5 } : undefined;
	const base = centre(mainSizesMap.desktop) ?? { x: 0, y: 0 };
	const overrides: Record<string, NodeOverride> = {};
	for (const [layoutType, size] of Object.entries(mainSizesMap)) {
		if (layoutType === 'desktop') continue;
		const at = centre(size);
		if (at) overrides[layoutType] = at;
	}
	return {
		id: WIN_VISUAL_SCENE_ID,
		name: 'Win visual',
		space: 'game',
		nodes: [
			{
				id: 'win-visual',
				slotId: 'Win',
				label: 'Win presentation (authored)',
				kind: 'componentInstance',
				componentId: WIN_PRESENTATION_COMPONENT_ID,
				x: base.x,
				y: base.y,
				...(Object.keys(overrides).length ? { overrides } : {}),
				params: { ...WIN_PRESENTATION_DEFAULTS, ...presentation, fitBoard: true },
			},
		],
	};
}

/**
 * The doc with the win swap applied to EVERY scene, plus the `winVisual` scene when no scene
 * PLACES a win visual (a `win` instance, or a `winPresentation` one on a doc swapped already) — the
 * split's shape, `referenceLayouts/lines.ts`. A `winVisual` scene that holds no instance (its win
 * was deleted) is replaced, not kept: the scene id alone places nothing, and `authoredWinStatus`
 * says `ready` for that doc, so the swap must leave a presentation to draw. The game applies it
 * once, when the doc loads, before either flow is built. A doc with nothing to swap and a visual of
 * its own ⇒ the SAME doc object.
 */
export function withAuthoredWinDoc<T extends Pick<LayoutDoc, 'scenes' | 'mainSizesMap'>>(
	doc: T,
	presentation?: AuthoredWinPresentation,
): T {
	const scenes = doc.scenes.map((scene) => withAuthoredWin(scene, presentation));
	const changed = scenes.some((scene, i) => scene !== doc.scenes[i]);
	const nodes = doc.scenes.flatMap((scene) => scene.nodes);
	const placed = hasWinInstance(nodes) || hasWinPresentationInstance(nodes);
	if (placed) return changed ? { ...doc, scenes } : doc;
	const visual = authoredWinVisualScene((doc.mainSizesMap ?? {}) as MainSizes, presentation);
	const hasEmptyVisualScene = scenes.some((scene) => scene.id === WIN_VISUAL_SCENE_ID);
	return {
		...doc,
		scenes: hasEmptyVisualScene
			? scenes.map((scene) => (scene.id === WIN_VISUAL_SCENE_ID ? visual : scene))
			: [...scenes, visual],
	};
}
