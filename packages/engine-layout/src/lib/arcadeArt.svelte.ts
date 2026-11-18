/**
 * ART DRAWN IN CODE FOR AN ONLINE ROOM (Salmons' original art): a field drawn in place of a
 * world screen's ground node, and a character drawn in place of its spawned instance's own tree.
 * The online runtime loads the art (a lazy chunk, only for a config whose generator has art) and
 * publishes a mount for each; `<IsoWorld>` and `<SpawnLayer>` draw them. Generic: engine-layout
 * knows only that a node or an instance has a mount.
 *
 * Precedence for an instance: a published clip (`arcadeClips.svelte.ts`), then its code look, then
 * its own tree. Nothing publishes here but an online room whose generator has art; every other
 * screen and spawn layer renders as before.
 *
 * A projected spawn layer can also draw art AMONG its instances ({@link LayerArt}): a surface over
 * the instances its art draws under it (Salmons' bloodstains over the swimming salmon, as the old
 * client's underwater layer) and under every other, and a wake under them all.
 */

import type { Application, Container } from 'pixi.js';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';

/** Draws into `into` (a container of its own, in the place it is drawn); returns the teardown. */
export type ArtMount = (into: Container, app: Application) => () => void;

/**
 * Art a projected spawn layer draws among its instances: `surface` over the instances drawn under
 * it ({@link setUnderSurface}) and under every other, `wake` under all of them. Each projects its
 * own world points, as the layer's instances are placed.
 */
export type LayerArt = { surface?: ArtMount; wake?: ArtMount };

/** The draw orders (zIndex) of a projected layer's under-surface band: an instance drawn under the
 *  surface is moved below every other by {@link UNDER_SURFACE} (its depth order kept within the
 *  band), the surface sits between the two and the wake below both. A depth order stays far inside
 *  them (`projection.ts` `isoDepthOrder`, under 2^34 for a world 128k px across). */
export const UNDER_SURFACE = 2 ** 40;
export const SURFACE_Z = -(2 ** 39);
export const WAKE_Z = -(2 ** 41);

const fields = new SvelteMap<string, ArtMount>();
const looks = new SvelteMap<string, ArtMount>();
const layers = new SvelteMap<string, LayerArt>();
const under = new SvelteSet<string>();

/** The art a world screen's top-level node `id` is drawn with, in place of the node. */
export const fieldArtOf = (id: string): ArtMount | undefined => fields.get(id);

/** An instance's code look, or `undefined` when it draws its clip or its own tree. */
export const codeLookOf = (id: string): ArtMount | undefined => looks.get(id);

/** Draw node `id` with `mount`. */
export const setFieldArt = (id: string, mount: ArtMount): void => {
	fields.set(id, mount);
};

/** Publish the code looks after a frame (only the changes). */
export const setCodeLooks = (next: ReadonlyMap<string, ArtMount>): void => {
	for (const id of looks.keys()) if (!next.has(id)) looks.delete(id);
	for (const [id, mount] of next) if (looks.get(id) !== mount) looks.set(id, mount);
};

/** The art spawn layer `layer` draws among its instances, if any. */
export const layerArtOf = (layer: string): LayerArt | undefined => layers.get(layer);

/** Draw `art` among spawn layer `layer`'s instances. */
export const setLayerArt = (layer: string, art: LayerArt): void => {
	layers.set(layer, art);
};

/** Whether an instance is drawn under its layer's surface. */
export const underSurface = (id: string): boolean => under.has(id);

/** Publish the instances drawn under the surface after a frame (only the changes). */
export const setUnderSurface = (next: ReadonlySet<string>): void => {
	for (const id of under) if (!next.has(id)) under.delete(id);
	for (const id of next) if (!under.has(id)) under.add(id);
};

/** The room is gone: nothing drawn in code. */
export const clearArt = (): void => {
	fields.clear();
	looks.clear();
	layers.clear();
	under.clear();
};
