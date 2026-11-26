import type { Container } from 'pixi.js';
import { SvelteMap } from 'svelte/reactivity';

import type { PropDepth } from './types';

/**
 * PROPS AMONG THE PLAYERS (`docs/design/arcade-prop-components.md` §5, P5): the pieces of the props
 * placed on an online room's zones (`propPieces.ts`), by the spawn layer they stand in. The arcade
 * runtime publishes them (`setSpawnProps`); `<IsoWorld>` draws a layer's `sorted` and `over` pieces
 * among its instances (`<SpawnProps>`), each a real `<ComponentInstance>`, so its state machine and
 * timelines run. The `water` and `behind` pieces are read by the field art that draws those layers
 * (`spawnPropsOf(layer, band)`).
 *
 * Arcade only: `<IsoWorld>` is the arcade seam's, and nothing is made at import, so a bundle that
 * reaches this module through `engine-layout/svelte` without the seam keeps none of it.
 */

/** One piece of a placed prop: an instance of a piece def, at a place on the ground. */
export type SpawnProp = {
	/** Unique in its layer (`<zone>:<child>:<cell>`), the instance's node id. */
	id: string;
	band: PropDepth;
	componentId: string;
	/** World px on the ground, as a spawned instance's place. */
	x: number;
	y: number;
	/** Screen px it is drawn higher than its projected place (the ground raised under it). */
	lift?: number;
	/** Ground depth px it sorts deeper than its place (`isoDepthOrder`'s `bias`). */
	bias?: number;
	params?: Record<string, unknown>;
	/** Number inputs held at a value (`<ComponentInstance inputValues>`: the cell's `index`). */
	inputValues?: Record<string, number>;
	/** Number inputs following an engine value source (`<ComponentInstance inputSources>`). */
	inputSources?: Record<string, string>;
};

let pieces: SvelteMap<string, readonly SpawnProp[]> | undefined;
/** Made on first use, not at import: the module has no top-level work for a bundle to keep. */
const live = (): SvelteMap<string, readonly SpawnProp[]> => (pieces ??= new SvelteMap());

/** The pieces of `band` (all of them when absent) standing in spawn layer `layer` (reactive). */
export const spawnPropsOf = (layer: string, band?: PropDepth): readonly SpawnProp[] => {
	const all = live().get(layer) ?? [];
	return band ? all.filter((p) => p.band === band) : all;
};

/** Publish the pieces standing in spawn layer `layer` (an empty list takes them away). */
export const setSpawnProps = (layer: string, next: readonly SpawnProp[]): void => {
	if (next.length) live().set(layer, next);
	else pieces?.delete(layer);
};

/** The room is gone: no props. */
export const clearSpawnProps = (): void => pieces?.clear();

/** Marks a piece's container in the spawn layer, so a search down the layer stops at it. */
export const SPAWN_PROP_LABEL = 'engine-layout:spawn-prop';

/**
 * The container spawn layer `layer`'s instances are drawn in: under the layer's own container
 * (`worldDrawing.svelte.ts` `projectedLayer`), down `<LayoutNodeView>`'s wrappers (each a lone
 * child below ground depth) to the one whose children are the instances (zIndex in ground-depth
 * order, from `ISO_DEPTH_SPREAD`), or that has none yet. `undefined` until the layer has drawn its
 * own wrapper.
 */
export function spawnInstancesOf(
	layer: Container | undefined,
	spread: number,
): Container | undefined {
	if (!layer || layer.children.length !== 1) return undefined;
	let at: Container = layer.children[0];
	while (at.children.length === 1) {
		const only: Container = at.children[0];
		if (only.label === SPAWN_PROP_LABEL || only.zIndex >= spread) break;
		at = only;
	}
	return at;
}
