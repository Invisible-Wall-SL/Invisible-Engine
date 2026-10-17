import {
	isModeScene,
	type ComponentDef,
	type LayoutDoc,
	type LayoutNode,
	type LayoutType,
	type Point2D,
	type Scene,
} from 'engine-layout';
import { loadComponent } from '../../componentStorage';
import { loadDocWithEtag, saveDoc } from '../../editorStorage';
import { editorDocBackupTarget, editorDocKey } from '../../projectPaths';
import { projectGameType } from '../../projects';
import { AdapterError, defineOp } from '../adapter';
import { baseEtagProp, baseOf, preconditionOf, projectOf } from './docs';

/**
 * Invisible Scene Editor adapters (PLAN 2.6), through `editorStorage.ts`: the editor's own
 * `loadDocWithEtag` and `saveDoc` (backup before the PUT, `If-Match`). The builder moves and
 * re-skins nodes that already exist. Nothing here adds or removes a screen or a node, and a node
 * bound to the game's math — the reel grid, a bet or buy-feature control, a readout of the bet, a
 * node on the bet / buy screens — is refused and listed, never changed (ADR-0002 "Locked items").
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
const MAX_COMPONENT_DEPTH = 4;

type DefLoader = (id: string, version: number | undefined) => Promise<ComponentDef | undefined>;

/** One load per component id and pinned version for the whole call. */
function defLoader(projectKey: string): DefLoader {
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
async function ownMathBinding(
	node: LayoutNode,
	defs: DefLoader,
	depth = 0,
): Promise<string | null> {
	if (node.kind === 'reelGrid') return 'it is the reel grid';
	if (node.kind === 'repeater') return `it repeats the game's "${node.source}" data`;
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
	if (depth >= MAX_COMPONENT_DEPTH) {
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
async function mathBinding(node: LayoutNode, defs: DefLoader, depth = 0): Promise<string | null> {
	const own = await ownMathBinding(node, defs, depth);
	if (own) return own;
	if (node.kind !== 'container') return null;
	for (const child of node.children) {
		const why = await mathBinding(child, defs, depth);
		if (why) return `it contains "${child.id}", and ${why}`;
	}
	return null;
}

function sceneMathBinding(scene: Scene): string | null {
	if (isModeScene(scene)) return "it is on a game-mode screen, which shows the mode's math";
	const screen = [scene.role, scene.id].find((name) => name && MATH_SCREENS.has(name));
	return screen ? `it is on the "${screen}" screen, which shows the bet and feature math` : null;
}

/**
 * Why a change to `node` (reached through `ancestors`) is refused before looking at the change: the
 * screen, the node or anything under it bound to the math, a parent bound to the math, or the
 * editor's own lock.
 */
async function lockOf(
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

/** `id`'s node and the containers above it, outermost first. */
function findNode(
	nodes: LayoutNode[],
	id: string,
	ancestors: LayoutNode[] = [],
): { node: LayoutNode; ancestors: LayoutNode[] } | null {
	for (const node of nodes) {
		if (node.id === id) return { node, ancestors };
		if (node.kind === 'container') {
			const hit = findNode(node.children, id, [...ancestors, node]);
			if (hit) return hit;
		}
	}
	return null;
}

interface NodeSummary {
	id: string;
	kind: LayoutNode['kind'];
	label: string | null;
	x: number;
	y: number;
	scale: Point2D | null;
	art: string | null;
	region: string | null;
	skin: string | null;
	clipId: string | null;
	/** Why scene.update_nodes refuses this node, or `null` when it may be moved and re-skinned. */
	locked: string | null;
	children?: NodeSummary[];
}

async function summarize(
	scene: Scene,
	ancestors: LayoutNode[],
	node: LayoutNode,
	defs: DefLoader,
): Promise<NodeSummary> {
	const out: NodeSummary = {
		id: node.id,
		kind: node.kind,
		label: node.label ?? null,
		x: node.x,
		y: node.y,
		scale: node.scale ?? null,
		art: node.kind === 'sprite' || node.kind === 'spine' ? node.assetKey : null,
		region: node.kind === 'sprite' ? (node.region ?? null) : null,
		skin: node.kind === 'spine' ? (node.skin ?? null) : null,
		clipId: node.kind === 'flipbook' ? node.clipId : null,
		locked: await lockOf(scene, ancestors, node, defs),
	};
	if (node.kind === 'container') {
		out.children = [];
		for (const child of node.children) {
			out.children.push(await summarize(scene, [...ancestors, node], child, defs));
		}
	}
	return out;
}

async function loadLayout(clientKey: string, projectKey: string) {
	const loaded = await loadDocWithEtag(clientKey, projectKey, await projectGameType(projectKey));
	if (loaded.corrupt) {
		throw new AdapterError(
			409,
			'unreadable_doc',
			"The project's layout is unreadable. A person must repair it in the Scene Editor.",
		);
	}
	return loaded;
}

export const getLayout = defineOp<
	{ screen?: string },
	{
		layouts: string[];
		mainSizes: LayoutDoc['mainSizesMap'];
		screens: { id: string; name: string; role: string | null; nodes: NodeSummary[] }[];
		baseEtag: string;
	}
>({
	tool: 'scene',
	name: 'get_layout',
	description:
		"The project's Scene Editor screens and their node trees: position, scale, art, and `locked` — why scene.update_nodes refuses a node (bound to the math, or locked in the editor). Plus the baseEtag to hand back to scene.update_nodes.",
	inputSchema: {
		type: 'object',
		properties: { screen: { type: 'string', description: 'Only this screen id.', maxLength: 120 } },
		additionalProperties: false,
	},
	agents: ['builder'],
	scope: 'project',
	write: false,
	handler: async (ctx, { screen }) => {
		const { clientKey, projectKey } = projectOf(ctx);
		const { doc, etag } = await loadLayout(clientKey, projectKey);
		const scenes = screen ? doc.scenes.filter((s) => s.id === screen) : doc.scenes;
		if (screen && scenes.length === 0) {
			throw new AdapterError(404, 'unknown_screen', `No screen "${screen}" in this project.`);
		}
		const defs = defLoader(projectKey);
		const screens = [];
		for (const s of scenes) {
			const nodes = [];
			for (const n of s.nodes) nodes.push(await summarize(s, [], n, defs));
			screens.push({ id: s.id, name: s.name, role: s.role ?? null, nodes });
		}
		return {
			layouts: Object.keys(doc.mainSizesMap),
			mainSizes: doc.mainSizesMap,
			screens,
			baseEtag: baseOf(etag),
		};
	},
});

export interface NodeChange {
	screen: string;
	node: string;
	layout?: string;
	x?: number;
	y?: number;
	scale?: Point2D;
	assetKey?: string;
	region?: string;
	skin?: string;
	clipId?: string;
}

const MOVE_FIELDS = ['x', 'y', 'scale'] as const;
const SKIN_FIELDS = ['assetKey', 'region', 'skin', 'clipId'] as const;

/** Which re-skin fields a node kind takes. Anything else on the change is refused. */
const SKINNABLE: Partial<Record<LayoutNode['kind'], readonly string[]>> = {
	sprite: ['assetKey', 'region'],
	spine: ['assetKey', 'skin'],
	flipbook: ['clipId'],
};

/** Apply one change to its node in place, or say why it cannot be applied. */
function applyChange(node: LayoutNode, change: NodeChange, layouts: string[]): string | null {
	const skin = SKIN_FIELDS.filter((f) => change[f] !== undefined);
	const move = MOVE_FIELDS.filter((f) => change[f] !== undefined);
	if (skin.length === 0 && move.length === 0) return 'the change moves and re-skins nothing';
	const takes = SKINNABLE[node.kind] ?? [];
	const unfit = skin.filter((f) => !takes.includes(f));
	if (unfit.length) return `a ${node.kind} node has no ${unfit.join(', ')} to re-skin`;
	if (change.layout !== undefined) {
		if (!layouts.includes(change.layout)) return `there is no "${change.layout}" layout`;
		if (skin.length) return 'art is re-skinned for every layout at once; drop `layout`';
		const layout = change.layout as LayoutType;
		const override = { ...node.overrides?.[layout] };
		for (const f of move) Object.assign(override, { [f]: change[f] });
		node.overrides = { ...node.overrides, [layout]: override };
		return null;
	}
	for (const f of [...move, ...skin]) Object.assign(node, { [f]: change[f] });
	return null;
}

const point = {
	type: 'object',
	properties: {
		x: { type: 'number', minimum: -100, maximum: 100 },
		y: { type: 'number', minimum: -100, maximum: 100 },
	},
	required: ['x', 'y'],
	additionalProperties: false,
} as const;
const coord = { type: 'number', minimum: -100000, maximum: 100000 } as const;
const artRef = { type: 'string', minLength: 1, maxLength: 400 } as const;

export const updateNodes = defineOp<
	{ changes: NodeChange[]; baseEtag: string },
	{
		applied: { screen: string; node: string }[];
		refused: { screen: string; node: string; reason: string }[];
		baseEtag: string;
	}
>({
	tool: 'scene',
	name: 'update_nodes',
	description:
		'Move (x, y, scale — for one layout when `layout` is given) and re-skin (sprite assetKey/region, rig assetKey/skin, flipbook clipId) nodes that already exist. It cannot add or remove screens or nodes. Nodes bound to the math are refused and listed in `refused`; the rest are saved together.',
	inputSchema: {
		type: 'object',
		properties: {
			changes: {
				type: 'array',
				maxItems: 64,
				items: {
					type: 'object',
					properties: {
						screen: { type: 'string', minLength: 1, maxLength: 120 },
						node: { type: 'string', minLength: 1, maxLength: 120 },
						layout: { type: 'string', minLength: 1, maxLength: 60 },
						x: coord,
						y: coord,
						scale: point,
						assetKey: artRef,
						region: artRef,
						skin: { type: 'string', minLength: 1, maxLength: 120 },
						clipId: { type: 'string', minLength: 1, maxLength: 120 },
					},
					required: ['screen', 'node'],
					additionalProperties: false,
				},
			},
			baseEtag: baseEtagProp,
		},
		required: ['changes', 'baseEtag'],
		additionalProperties: false,
	},
	agents: ['builder'],
	scope: 'project',
	write: true,
	writes: (_input, scope) => [
		editorDocKey(scope.clientKey, scope.projectKey),
		editorDocBackupTarget(scope.clientKey, scope.projectKey).prefix,
	],
	handler: async (ctx, { changes, baseEtag }) => {
		const { clientKey, projectKey } = projectOf(ctx);
		const { doc, etag } = await loadLayout(clientKey, projectKey);
		if (etag === null) {
			throw new AdapterError(404, 'no_layout', 'The project has no Scene Editor layout to change.');
		}
		const defs = defLoader(projectKey);
		const layouts = Object.keys(doc.mainSizesMap);
		const applied: { screen: string; node: string }[] = [];
		const refused: { screen: string; node: string; reason: string }[] = [];
		for (const change of changes) {
			const scene = doc.scenes.find((s) => s.id === change.screen);
			if (!scene) {
				throw new AdapterError(404, 'unknown_screen', `No screen "${change.screen}".`);
			}
			const found = findNode(scene.nodes, change.node);
			if (!found) {
				throw new AdapterError(
					404,
					'unknown_node',
					`No node "${change.node}" on "${change.screen}". This op cannot add nodes.`,
				);
			}
			const reason =
				(await lockOf(scene, found.ancestors, found.node, defs)) ??
				applyChange(found.node, change, layouts);
			if (reason) refused.push({ screen: change.screen, node: change.node, reason });
			else applied.push({ screen: change.screen, node: change.node });
		}
		if (applied.length === 0) return { applied, refused, baseEtag };
		const saved = await saveDoc(
			clientKey,
			projectKey,
			doc,
			preconditionOf(baseEtag),
			'auto',
			ctx.savedBy,
		);
		return { applied, refused, baseEtag: baseOf(saved.etag) };
	},
});

export const SCENE_OPS = [getLayout, updateNodes];
