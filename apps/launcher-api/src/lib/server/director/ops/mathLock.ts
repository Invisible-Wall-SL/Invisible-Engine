import {
	collectComponentIds,
	isCountRepeater,
	isModeScene,
	type ComponentDef,
	type LayoutNode,
	type Scene,
} from 'engine-layout';
import { loadComponent } from '../../componentStorage';

/**
 * What ties a Scene Editor node to the game's math, shared by every adapter that edits something
 * a node shows: the scene ops, the FX ops (an effect placed by a bound node) and the component
 * ops (a def held by a bound instance). Moved verbatim from `scene.ts`; one rule for all of them.
 */

/** Words that tie a binding to the math contract: stakes, bet levels and modes, paylines, features. */
const MATH_WORD =
	/(bet|stake|payline|paytable|ways|coin|buy|bonus|feature|trigger|increase|decrease|level|mode|rtp|jackpot)/i;

/**
 * Screens that ARE math: the bet menu, the buy-feature menu and its confirm. The runtime finds each
 * by its role, else by this legacy id (`engine-layout` `sceneByRole`), and the reference layouts
 * seed the buy screens by id with no role, so either one locks the screen. A mode's screens are
 * locked too (`isModeScene`).
 */
const MATH_SCREENS = new Set(['betMenu', 'buyFeature', 'buyConfirm']);

/** How deep a component placed inside a component is followed; deeper is refused, not trusted. */
const MAX_NEST_DEPTH = 4;

export type DefLoader = (
	id: string,
	version: number | undefined,
) => Promise<ComponentDef | undefined>;

/** One load per component id and pinned version for the whole call. */
export function defLoader(projectKey: string): DefLoader {
	const seen = new Map<string, Promise<ComponentDef | undefined>>();
	return (id, version) => {
		const key = `${id}@${version ?? 'latest'}`;
		if (!seen.has(key)) seen.set(key, loadComponent(id, projectKey, version));
		return seen.get(key)!;
	};
}

/**
 * Why `node` itself is bound to the math, or `null`: its own bindings, and for a placed component
 * the def's defaults for the params it leaves unset and every node inside the def. Its children are
 * checked by {@link mathBinding}.
 */
export async function ownMathBinding(
	node: LayoutNode,
	defs: DefLoader,
	depth = 0,
): Promise<string | null> {
	if (node.kind === 'reelGrid') return 'it is the reel grid';
	if (node.kind === 'repeater') {
		if (!isCountRepeater(node)) return `it repeats the game's "${node.source}" data`;
		const fed = [node.count.source, ...Object.values(node.passInputs ?? {})].filter(Boolean);
		if (fed.length) return `it counts the game's ${fed.map((s) => `"${s}"`).join(', ')}`;
		return null;
	}
	const params = node.kind === 'componentInstance' ? (node.params ?? {}) : {};
	// A layout's override can give the instance another action or source on that layout only.
	const overrideParams = Object.values(node.overrides ?? {}).map((o) => o?.params ?? {});
	const named: [string, unknown][] = [
		['press action', node.pressAction],
		['action', params.action],
		['value source', params.source],
		...overrideParams.flatMap((p): [string, unknown][] => [
			['action on one layout', p.action],
			['value source on one layout', p.source],
		]),
		['component', node.kind === 'componentInstance' ? node.componentId : undefined],
		['bound component', node.bind?.component],
		['bound action', node.bind?.props?.action],
		['bound source', node.bind?.props?.source],
		...(node.valueBindings ?? []).flatMap((b): [string, unknown][] => [
			['value binding', b.source],
			['value binding', b.of],
		]),
		...Object.values(node.paramBindings ?? {}).map((v): [string, unknown] => ['param binding', v]),
	];
	for (const [what, value] of named) {
		if (typeof value === 'string' && MATH_WORD.test(value)) return `its ${what} is "${value}"`;
	}
	if (node.kind !== 'componentInstance') return null;
	if (depth >= MAX_NEST_DEPTH) {
		return `its component "${node.componentId}" nests too deep to check`;
	}
	const def = await defs(node.componentId, node.componentVersion);
	if (!def) return `its component "${node.componentId}" could not be read to check`;
	for (const param of def.params ?? []) {
		const unset = params[param.key] === undefined;
		if (unset && typeof param.default === 'string' && MATH_WORD.test(param.default)) {
			return `its component's ${param.key} defaults to "${param.default}"`;
		}
	}
	const inner = await mathBinding(def.root, defs, depth + 1);
	return inner ? `its component "${node.componentId}" holds a node where ${inner}` : null;
}

/** Why `node` — itself, or anything under it that moves with it — is bound to the math. */
export async function mathBinding(
	node: LayoutNode,
	defs: DefLoader,
	depth = 0,
): Promise<string | null> {
	const own = await ownMathBinding(node, defs, depth);
	if (own) return own;
	if (node.kind !== 'container') return null;
	for (const child of node.children) {
		const why = await mathBinding(child, defs, depth);
		if (why) return `it contains "${child.id}", and ${why}`;
	}
	return null;
}

export function sceneMathBinding(scene: Scene): string | null {
	if (isModeScene(scene)) return "it is on a game-mode screen, which shows the mode's math";
	const screen = [scene.role, scene.id].find((name) => name && MATH_SCREENS.has(name));
	return screen ? `it is on the "${screen}" screen, which shows the bet and feature math` : null;
}

/**
 * Why a change to `node` (reached through `ancestors`) is refused before looking at the change: the
 * screen, the node or anything under it bound to the math, a parent bound to the math, or the
 * editor's own lock.
 */
export async function lockOf(
	scene: Scene,
	ancestors: LayoutNode[],
	node: LayoutNode,
	defs: DefLoader,
): Promise<string | null> {
	const onScreen = sceneMathBinding(scene);
	if (onScreen) return `bound to the math: ${onScreen}`;
	for (const parent of ancestors) {
		const why = await ownMathBinding(parent, defs);
		if (why) return `bound to the math: its parent "${parent.id}" is, as ${why}`;
	}
	const own = await mathBinding(node, defs);
	if (own) return `bound to the math: ${own}`;
	return node.locked ? 'it is locked in the Scene Editor' : null;
}

/** Which re-skin fields a node kind takes. Anything else on the change is refused. */
export const SKINNABLE: Partial<Record<LayoutNode['kind'], readonly string[]>> = {
	sprite: ['assetKey', 'region'],
	spine: ['assetKey', 'skin'],
	flipbook: ['clipId'],
};

/** A scene node that places components: an instance, a repeater's card or a spawn layer's list. */
export interface ComponentHolder {
	scene: Scene;
	ancestors: LayoutNode[];
	node: LayoutNode;
}

/** Every holder in `scenes`, through containers, outermost scene first. */
export function* sceneHolders(
	scenes: readonly Scene[],
	nodes?: LayoutNode[],
	scene?: Scene,
	ancestors: LayoutNode[] = [],
): Generator<ComponentHolder> {
	if (!nodes) {
		for (const s of scenes) yield* sceneHolders(scenes, s.nodes, s);
		return;
	}
	for (const node of nodes) {
		if (node.kind === 'container') {
			yield* sceneHolders(scenes, node.children, scene, [...ancestors, node]);
		} else if (collectComponentIds([node]).length > 0) {
			yield { scene: scene!, ancestors, node };
		}
	}
}

/** The components a holder places, directly and through the defs they nest. */
export interface ComponentClosure {
	ids: Set<string>;
	/** The defs that could be read, the holder's pinned version first. */
	defs: ComponentDef[];
	/** The chain nests past {@link MAX_NEST_DEPTH}: what lies beyond is unchecked. */
	deep: boolean;
}

/**
 * What `node` places: its component ids, the defs those nest (a nested pin is ignored, as the bake
 * does), cut at the same depth as {@link ownMathBinding}. A def that cannot be read is skipped.
 */
export async function componentClosure(
	node: LayoutNode,
	defs: DefLoader,
): Promise<ComponentClosure> {
	const out: ComponentClosure = { ids: new Set(), defs: [], deep: false };
	const walk = async (ids: string[], depth: number, version?: number): Promise<void> => {
		for (const id of ids) {
			if (out.ids.has(id)) continue;
			out.ids.add(id);
			if (depth >= MAX_NEST_DEPTH) {
				out.deep = true;
				continue;
			}
			const def = await defs(id, depth === 0 ? version : undefined);
			if (!def) continue;
			out.defs.push(def);
			await walk(collectComponentIds([def.root]), depth + 1);
		}
	};
	await walk(
		collectComponentIds([node]),
		0,
		node.kind === 'componentInstance' ? node.componentVersion : undefined,
	);
	return out;
}
