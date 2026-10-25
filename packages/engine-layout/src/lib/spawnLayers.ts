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

import { spawnableComponentIds, spawnLayerGrid } from './spawnLayerFields';
import type { SpawnLayerNode } from './types';

export { sceneSpawnLayers, spawnableComponentIds, spawnLayerGrid } from './spawnLayerFields';

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
