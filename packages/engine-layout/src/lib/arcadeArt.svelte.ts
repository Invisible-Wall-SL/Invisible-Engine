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
 */

import type { Application, Container } from 'pixi.js';
import { SvelteMap } from 'svelte/reactivity';

/** Draws into `into` (a container of its own, in the place it is drawn); returns the teardown. */
export type ArtMount = (into: Container, app: Application) => () => void;

const fields = new SvelteMap<string, ArtMount>();
const looks = new SvelteMap<string, ArtMount>();

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

/** The room is gone: nothing drawn in code. */
export const clearArt = (): void => {
	fields.clear();
	looks.clear();
};
