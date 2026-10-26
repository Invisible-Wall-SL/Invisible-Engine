/**
 * The game's live set of spawned instances (`docs/design/game-families.md` §3.3): Flow's env writes
 * it, every mounted `<SpawnLayer>` draws its layer from it. One per game bundle. On the
 * `engine-layout/svelte` entry, not the bare one: it is the only part of the layer that needs
 * `engine-flow-v2` at runtime, and the bare entry is loaded by Node scripts that must not pull that
 * barrel. The node's fields are read in `spawnLayerFields.ts`.
 */

import { createSpawnStore, type SpawnStore } from 'engine-flow-v2';

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

/** Each mounted spawn layer's space: from the canvas's global px into the layer's own. */
const spaces = new Map<string, (x: number, y: number) => { x: number; y: number }>();

/**
 * A mounted `<SpawnLayer>` registers how a canvas point maps into its space (its node's transform
 * on its screen), so a game can read the pointer where the layer's instances are placed (an arcade
 * character following a touch, P10.11). Returns the unregister.
 */
export function registerSpawnLayerSpace(
	layer: string,
	toLocal: (x: number, y: number) => { x: number; y: number },
): () => void {
	spaces.set(layer, toLocal);
	return () => {
		if (spaces.get(layer) === toLocal) spaces.delete(layer);
	};
}

/** A canvas point (global px) in spawn layer `layer`'s space, or `undefined` while it is not mounted. */
export function spawnLayerPoint(layer: string, x: number, y: number) {
	return spaces.get(layer)?.(x, y);
}
