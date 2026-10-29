/**
 * THE LIVE WORLD CAMERA the game draws by (P10.12): where the play field's view is in its world,
 * the drawn-only shake, and which spawned instances are culled. The arcade runtime writes it once
 * a frame after its loop steps; `<LayoutScene>` (the world container), a parallax node and
 * `<SpawnLayer>` (culling) read it. Generic: engine-layout knows only that there is one view.
 *
 * Nothing writes it in a game with no world camera, and nothing reads it outside a screen that
 * declares one (`hasWorldCamera`), so every other screen renders as before.
 */

import { getContext, setContext, type Component, type Snippet } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';

import type { LayoutNode, Point2D } from './types';

const view = $state({ x: 0, y: 0, shakeX: 0, shakeY: 0, w: 0, h: 0 });
const culled = new SvelteSet<string>();

/** The view's top-left in world px, this frame's shake, and its size (0 until a loop gives it). */
export const worldCameraView = (): {
	x: number;
	y: number;
	shakeX: number;
	shakeY: number;
	w: number;
	h: number;
} => view;

/** Publish the camera after a frame. Only changed fields are written, so a still camera
 *  re-draws nothing. */
export const setWorldCameraView = (next: {
	x: number;
	y: number;
	shakeX: number;
	shakeY: number;
	view?: { w: number; h: number };
}): void => {
	if (view.x !== next.x) view.x = next.x;
	if (view.y !== next.y) view.y = next.y;
	if (view.shakeX !== next.shakeX) view.shakeX = next.shakeX;
	if (view.shakeY !== next.shakeY) view.shakeY = next.shakeY;
	if (next.view && view.w !== next.view.w) view.w = next.view.w;
	if (next.view && view.h !== next.view.h) view.h = next.view.h;
};

/** What draws a projected world screen's nodes (`Scene.projection`, P11.4): `node` renders one of
 *  them as a flat screen would. */
export type ProjectedWorld = Component<{
	nodes: readonly LayoutNode[];
	node: Snippet<[LayoutNode]>;
}>;

let projectedWorld: ProjectedWorld | undefined;

/** The arcade family registers its isometric drawing (`apps/lines` `families/arcade.ts`); a
 *  runtime without arcade registers none and draws every screen flat. */
export const registerProjectedWorld = (world: ProjectedWorld): void => {
	projectedWorld = world;
};

/** The registered projected-world drawing, if any. */
export const getProjectedWorld = (): ProjectedWorld | undefined => projectedWorld;

/** How a spawn layer on a projected screen places its instances: where a world place is drawn,
 *  its depth, and a drawn point back to the world. */
export type SpawnProjection = {
	project: (x: number, y: number) => Point2D;
	unproject: (x: number, y: number) => Point2D;
	depth: (x: number, y: number) => number;
};

const PROJECTION_KEY = Symbol('engine-layout:spawnProjection');

/** Mark a subtree as drawn projected (the projected world sets it). */
export const setSpawnProjection = (projection: SpawnProjection): void => {
	setContext(PROJECTION_KEY, projection);
};

/** The projection this subtree's spawn layers place by, or none (flat). */
export const spawnProjection = (): SpawnProjection | undefined =>
	getContext<SpawnProjection | undefined>(PROJECTION_KEY);

/** Whether a spawned instance is out of view and not drawn. */
export const isCulled = (id: string): boolean => culled.has(id);

/** Publish the culled set after a frame (only the changes). */
export const setCulled = (ids: ReadonlySet<string>): void => {
	for (const id of culled) if (!ids.has(id)) culled.delete(id);
	for (const id of ids) if (!culled.has(id)) culled.add(id);
};

const IN_WORLD_KEY = Symbol('engine-layout:inWorldCamera');

/** Mark a subtree as drawn through the world camera (`<LayoutScene>` of a world screen). */
export const setInWorldCamera = (): void => {
	setContext(IN_WORLD_KEY, true);
};

/** Whether this subtree is drawn through the world camera (so its spawned instances are culled). */
export const inWorldCamera = (): boolean => getContext<boolean | undefined>(IN_WORLD_KEY) === true;
