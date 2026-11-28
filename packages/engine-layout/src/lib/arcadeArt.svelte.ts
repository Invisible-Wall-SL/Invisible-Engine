/**
 * ART DRAWN IN CODE FOR AN ONLINE ROOM (Salmons' original art): a field drawn in place of a
 * world screen's ground node, a screen's part drawn in place of its top-level node (Salmons' win
 * animation, death screen, lobby note), and a character drawn in place of its spawned instance's
 * own tree. The online runtime loads the art (a lazy chunk, only for a config whose generator has
 * art) and publishes a mount for each; `<IsoWorld>`, `<LayoutScene>` and `<SpawnLayer>` draw them.
 * Generic: engine-layout knows only that a node or an instance has a mount.
 *
 * Precedence for an instance: a published clip (`arcadeClips.svelte.ts`), then its code look, then
 * its own tree. An instance may also be given a depth bias (`setDepths`): a body the runtime draws
 * raised off the ground under it (Salmons' fisherman on a bridge's deck) sorts by it in a projected
 * layer. Nothing publishes here but an online room whose generator has art; every other
 * screen and spawn layer renders as before.
 */

import type { Application, Container } from 'pixi.js';
import { SvelteMap } from 'svelte/reactivity';

/** Draws into `into` (a container of its own, in the place it is drawn); returns the teardown. */
export type ArtMount = (into: Container, app: Application) => () => void;

const fields = new SvelteMap<string, ArtMount>();
const looks = new SvelteMap<string, ArtMount>();
const depths = new SvelteMap<string, number>();

/** The art a screen's top-level node `id` is drawn with, in place of the node. */
export const fieldArtOf = (id: string): ArtMount | undefined => fields.get(id);

/** An instance's code look, or `undefined` when it draws its clip or its own tree. */
export const codeLookOf = (id: string): ArtMount | undefined => looks.get(id);

/** How much deeper than its place instance `id` is drawn in a projected layer's depth order, ground
 *  depth px (`projection.ts` `isoDepthOrder`'s `bias`); 0 for one given none. */
export const depthOf = (id: string): number => depths.get(id) ?? 0;

/** Publish the instances' depth biases after a frame (only the changes; an instance left out has
 *  none). */
export const setDepths = (next: ReadonlyMap<string, number>): void => {
	for (const id of depths.keys()) if (!next.has(id)) depths.delete(id);
	for (const [id, depth] of next) if (depths.get(id) !== depth) depths.set(id, depth);
};

/** Draw node `id` with `mount`. */
export const setFieldArt = (id: string, mount: ArtMount): void => {
	fields.set(id, mount);
};

/** Publish the code looks after a frame (only the changes). */
export const setCodeLooks = (next: ReadonlyMap<string, ArtMount>): void => {
	for (const id of looks.keys()) if (!next.has(id)) looks.delete(id);
	for (const [id, mount] of next) if (looks.get(id) !== mount) looks.set(id, mount);
};

/** The room is gone: nothing drawn in code. */
export const clearArt = (): void => {
	fields.clear();
	looks.clear();
	depths.clear();
};
