/**
 * HOW THE PROJECTED WORLD IS DRAWN this page (P11.4): its projector (`projection.ts`
 * `sceneProjector`: isometric, or mirrored) and the camera's zoom (design px a world px). The arcade
 * runtime sets both when it takes the play field's world screen and its camera (`apps/lines`
 * `game/arcade.ts`, `game/online.ts`), before it first gives the view a size, so `<IsoWorld>` (which
 * draws nothing until then) never draws by another. Apart from `worldCameraView.svelte.ts` so a
 * runtime without the arcade family carries none of it. Default: isometric, zoom 1.
 */

import type { Container } from 'pixi.js';

import { ISO_PROJECTOR, type IsoProjector } from './projection';

class WorldDrawing {
	projector = $state<IsoProjector>(ISO_PROJECTOR);
	zoom = $state(1);
}

// Made on first use, so a runtime that imports the barrel but never draws a projected world
// carries no module-level state call (its bundle keeps its bytes).
let drawing: WorldDrawing | undefined;
const live = (): WorldDrawing => (drawing ??= new WorldDrawing());

/** The projected world's projector and zoom (reactive). */
export const worldDrawing = (): { readonly projector: IsoProjector; readonly zoom: number } =>
	live();

/** Set the projector the projected world is drawn by (the world screen's `sceneProjector`). */
export const setWorldProjector = (projector: IsoProjector | undefined): void => {
	const next = projector ?? ISO_PROJECTOR;
	if (live().projector !== next) live().projector = next;
};

/** Set the camera's zoom (`engine-mechanics` `cameraZoom`; > 0, 1 draws as before). */
export const setWorldZoom = (zoom: number): void => {
	const next = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
	if (live().zoom !== next) live().zoom = next;
};

const layers: Record<string, Container | undefined> = {};

/** `<IsoWorld>` registers each top-level spawn layer's own container by the node's id while it is
 *  drawn (returns the unregister), for art that stands pieces among its instances. */
export const registerProjectedLayer = (id: string, container: Container): (() => void) => {
	layers[id] = container;
	return () => {
		if (layers[id] === container) delete layers[id];
	};
};

/** A projected world's spawn layer container by its node's id, while it is drawn. */
export const projectedLayer = (id: string): Container | undefined => layers[id];
