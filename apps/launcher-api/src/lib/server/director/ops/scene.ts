import type { LayoutDoc, LayoutNode, LayoutType, Point2D, Scene } from 'engine-layout';
import { loadDocWithEtag, saveDoc } from '../../editorStorage';
import { editorDocKey } from '../../projectPaths';
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

/** Words that tie a binding to the math contract: bet levels, bet modes, paylines, features. */
const MATH_WORD =
	/(bet|payline|paytable|buy|bonus|feature|trigger|increase|decrease|level|mode|rtp|jackpot)/i;

/** Screens that ARE math: the bet menu and the buy-feature menu and its confirm. */
const MATH_ROLES = new Set(['betMenu', 'buyFeature', 'buyConfirm', 'mode']);

/** Why `node` itself is bound to the math, or `null`. Its children are checked by the caller. */
function ownMathBinding(node: LayoutNode): string | null {
	if (node.kind === 'reelGrid') return 'it is the reel grid';
	if (node.kind === 'repeater') return `it repeats the game's "${node.source}" data`;
	const params = node.kind === 'componentInstance' ? (node.params ?? {}) : {};
	const named: [string, unknown][] = [
		['press action', node.pressAction],
		['action', params.action],
		['value source', params.source],
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
	return null;
}

/** Why `node` — itself, or anything under it that moves with it — is bound to the math. */
function mathBinding(node: LayoutNode): string | null {
	const own = ownMathBinding(node);
	if (own) return own;
	if (node.kind !== 'container') return null;
	for (const child of node.children) {
		const why = mathBinding(child);
		if (why) return `it contains "${child.id}", and ${why}`;
	}
	return null;
}

function sceneMathBinding(scene: Scene): string | null {
	return scene.role && MATH_ROLES.has(scene.role)
		? `it is on the "${scene.role}" screen, which shows the bet and feature math`
		: null;
}

function findNode(nodes: LayoutNode[], id: string): LayoutNode | null {
	for (const node of nodes) {
		if (node.id === id) return node;
		if (node.kind === 'container') {
			const hit = findNode(node.children, id);
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
	mathBound: string | null;
	children?: NodeSummary[];
}

function summarize(node: LayoutNode, sceneLock: string | null): NodeSummary {
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
		mathBound: sceneLock ?? mathBinding(node),
	};
	if (node.kind === 'container') out.children = node.children.map((c) => summarize(c, sceneLock));
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
		"The project's Scene Editor screens and their node trees: position, scale, art, and `mathBound` — why a node is locked to the math (scene.update_nodes refuses those). Plus the baseEtag to hand back to scene.update_nodes.",
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
		return {
			layouts: Object.keys(doc.mainSizesMap),
			mainSizes: doc.mainSizesMap,
			screens: scenes.map((s) => ({
				id: s.id,
				name: s.name,
				role: s.role ?? null,
				nodes: s.nodes.map((n) => summarize(n, sceneMathBinding(s))),
			})),
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
		'Move (x, y, scale — for one layout when `layout` is given) and re-skin (sprite assetKey/region, spine assetKey/skin, flipbook clipId) nodes that already exist. It cannot add or remove screens or nodes. Nodes bound to the math are refused and listed in `refused`; the rest are saved together.',
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
	writes: (_input, scope) => [editorDocKey(scope.clientKey, scope.projectKey)],
	handler: async (ctx, { changes, baseEtag }) => {
		const { clientKey, projectKey } = projectOf(ctx);
		const { doc, etag } = await loadLayout(clientKey, projectKey);
		const layouts = Object.keys(doc.mainSizesMap);
		const applied: { screen: string; node: string }[] = [];
		const refused: { screen: string; node: string; reason: string }[] = [];
		for (const change of changes) {
			const scene = doc.scenes.find((s) => s.id === change.screen);
			if (!scene) {
				throw new AdapterError(404, 'unknown_screen', `No screen "${change.screen}".`);
			}
			const node = findNode(scene.nodes, change.node);
			if (!node) {
				throw new AdapterError(
					404,
					'unknown_node',
					`No node "${change.node}" on "${change.screen}". This op cannot add nodes.`,
				);
			}
			const locked = sceneMathBinding(scene) ?? mathBinding(node);
			const reason = locked ? `bound to the math: ${locked}` : applyChange(node, change, layouts);
			if (reason) refused.push({ screen: change.screen, node: change.node, reason });
			else applied.push({ screen: change.screen, node: change.node });
		}
		if (applied.length === 0) return { applied, refused, baseEtag: baseOf(etag) };
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
