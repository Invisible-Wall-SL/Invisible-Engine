/**
 * A `spawnLayer` node's fields, read defensively (the save path keeps a node's fields as authored)
 * — dependency-free, so the ship walk (`collectComponentIds`) and every Node script that loads it
 * stay free of `engine-flow-v2`. The live set itself is `spawnLayers.ts`.
 */

import type { LayoutNode, Scene, SpawnLayerNode, SpawnLayerGrid } from './types';

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
export const spawnLayerGrid = (node: SpawnLayerNode): SpawnLayerGrid | undefined => {
	const grid = node.grid;
	if (!grid || typeof grid !== 'object') return undefined;
	const cols = positiveInt(grid.cols);
	const rows = positiveInt(grid.rows);
	const pitch = typeof grid.pitch === 'number' && grid.pitch > 0 ? grid.pitch : undefined;
	return cols && rows && pitch ? { cols, rows, pitch } : undefined;
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
