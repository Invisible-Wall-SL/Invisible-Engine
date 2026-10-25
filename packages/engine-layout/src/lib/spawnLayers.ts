/**
 * Spawn layers (`docs/design/game-families.md` §3.3) — the layout side of the live set. A
 * `spawnLayer` node's fields are read here, defensively (the save path keeps a node's fields as
 * authored), into the spec the live set (`engine-flow-v2` `createSpawnStore`) enforces. The game's
 * one live set is the module singleton below: Flow's env writes it, every mounted `<SpawnLayer>`
 * draws its layer from it. Svelte-free and on the bare `engine-layout` entry, so a Node gate drives
 * it directly; each game bundle has its own copy.
 */

import {
	createSpawnStore,
	effectiveSpawnCap,
	type SpawnLayerSpec,
	type SpawnStore,
} from 'engine-flow-v2';

import type { LayoutNode, Scene, SpawnLayerNode } from './types';

/** The ids a layer may spawn: the strings of its `spawnable`, each once, in order. */
export const spawnableComponentIds = (node: SpawnLayerNode): string[] => [
	...new Set(
		(Array.isArray(node.spawnable) ? node.spawnable : []).filter(
			(id): id is string => typeof id === 'string' && id.length > 0,
		),
	),
];

const positiveInt = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;

/** A grid layer's lattice, when its `grid` is whole: cols and rows ≥ 1, a pitch > 0. */
export const spawnLayerGrid = (node: SpawnLayerNode): SpawnLayerSpec['grid'] => {
	const grid = node.grid;
	if (!grid || typeof grid !== 'object') return undefined;
	const cols = positiveInt(grid.cols);
	const rows = positiveInt(grid.rows);
	const pitch = typeof grid.pitch === 'number' && grid.pitch > 0 ? grid.pitch : undefined;
	return cols && rows && pitch ? { cols, rows, pitch } : undefined;
};

/** The spec the live set enforces for a layer node. A `grid` layer whose lattice is not whole
 *  places freely (a cell spawn into it is refused). */
export const spawnLayerSpec = (node: SpawnLayerNode, sceneId?: string): SpawnLayerSpec => {
	const grid = node.placement === 'grid' ? spawnLayerGrid(node) : undefined;
	return {
		id: node.id,
		spawnable: spawnableComponentIds(node),
		cap: effectiveSpawnCap(node.cap),
		placement: grid ? 'grid' : 'free',
		...(grid ? { grid } : {}),
		...(sceneId !== undefined ? { sceneId } : {}),
	};
};

/** Every `spawnLayer` node of a scene tree, with the scene it is placed on (container children
 *  included; a layer inside a component def is not a screen's). */
export const sceneSpawnLayers = (
	scenes: readonly Scene[],
): { node: SpawnLayerNode; sceneId: string }[] => {
	const out: { node: SpawnLayerNode; sceneId: string }[] = [];
	for (const scene of scenes) {
		const walk = (node: LayoutNode): void => {
			if (node.kind === 'spawnLayer') out.push({ node, sceneId: scene.id });
			const children = (node as { children?: LayoutNode[] }).children;
			if (Array.isArray(children)) children.forEach(walk);
		};
		(scene.nodes ?? []).forEach(walk);
	}
	return out;
};

let store: SpawnStore | undefined;

/**
 * The game's live set (one per bundle, made on first use). A refused spawn is logged once per
 * layer, component and reason — a full layer refusing every frame must not flood the console.
 */
export function spawnStore(): SpawnStore {
	if (store) return store;
	const warned = new Set<string>();
	store = createSpawnStore({
		onRefuse: (layer, componentId, reason) => {
			const key = `${layer}\u0000${componentId}\u0000${reason}`;
			if (warned.has(key)) return;
			warned.add(key);
			console.warn(
				`[engine-layout] spawn layer '${layer}' refused '${componentId}' (${reason}) — it was dropped.`,
			);
		},
	});
	return store;
}
