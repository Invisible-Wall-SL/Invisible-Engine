/**
 * THE LIVE WORLD CAMERA the game draws by (P10.12): where the play field's view is in its world,
 * the drawn-only shake, and which spawned instances are culled. The arcade runtime writes it once
 * a frame after its loop steps; `<LayoutScene>` (the world container), a parallax node and
 * `<SpawnLayer>` (culling) read it. Generic: engine-layout knows only that there is one view.
 *
 * Nothing writes it in a game with no world camera, and nothing reads it outside a screen that
 * declares one (`hasWorldCamera`), so every other screen renders as before.
 */

import { getContext, setContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';

const view = $state({ x: 0, y: 0, shakeX: 0, shakeY: 0 });
const culled = new SvelteSet<string>();

/** The view's top-left in world px, and this frame's shake. */
export const worldCameraView = (): { x: number; y: number; shakeX: number; shakeY: number } => view;

/** Publish the camera after a frame. Only changed fields are written, so a still camera
 *  re-draws nothing. */
export const setWorldCameraView = (next: {
	x: number;
	y: number;
	shakeX: number;
	shakeY: number;
}): void => {
	if (view.x !== next.x) view.x = next.x;
	if (view.y !== next.y) view.y = next.y;
	if (view.shakeX !== next.shakeX) view.shakeX = next.shakeX;
	if (view.shakeY !== next.shakeY) view.shakeY = next.shakeY;
};

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
