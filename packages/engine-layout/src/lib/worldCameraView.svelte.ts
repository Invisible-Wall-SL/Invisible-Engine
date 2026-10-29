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

import type { LayoutNode, Point2D, TilemapNode } from './types';

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

/**
 * A projected world screen's scope (P11.4), set by the projected world for its subtree. Only the
 * screen's own TOP-LEVEL spawn layers (`layers`) and tilemaps (`tilemaps`) read it, by node id, so
 * one nested in a ground node or in a spawned instance's component draws as it would flat (and is
 * never projected twice). A spawn layer places its instances by `project` and draws them in
 * `depth` order (its spawn order `seq` breaking a tie), and reads a pointer back by `unproject`; a
 * tilemap is drawn by `tilemap`.
 */
export type WorldProjection = {
	layers: ReadonlySet<string>;
	tilemaps: ReadonlySet<string>;
	tilemap: Component<{ node: TilemapNode }>;
	project: (x: number, y: number) => Point2D;
	unproject: (x: number, y: number) => Point2D;
	depth: (x: number, y: number, seq: number) => number;
};

const PROJECTION_KEY = Symbol('engine-layout:worldProjection');

/** Set the projected world's scope for its subtree. */
export const setWorldProjection = (projection: WorldProjection): void => {
	setContext(PROJECTION_KEY, projection);
};

/** The projected world's scope this subtree is in, or none (flat). */
export const worldProjection = (): WorldProjection | undefined =>
	getContext<WorldProjection | undefined>(PROJECTION_KEY);

/** Whether a spawned instance is out of view and not drawn. */
export const isCulled = (id: string): boolean => culled.has(id);

const hiding = $state({ on: false });

/** Turn culling on beyond world-camera screens (P11.5: a game whose abilities put characters out,
 *  hidden through the culled set). Set once, before the first spawn. */
export const setHiding = (): void => {
	hiding.on = true;
};

/** Whether the culled set hides instances on every screen, not only a world-camera one. */
export const hidingOn = (): boolean => hiding.on;

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
