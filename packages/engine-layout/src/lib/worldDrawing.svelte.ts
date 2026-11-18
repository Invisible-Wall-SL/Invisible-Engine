/**
 * HOW THE PROJECTED WORLD IS DRAWN this page (P11.4): its projector (`projection.ts`
 * `sceneProjector`: isometric, or mirrored) and the camera's zoom (design px a world px). The arcade
 * runtime sets both when it takes the play field's world screen and its camera (`apps/lines`
 * `game/arcade.ts`, `game/online.ts`), before it first gives the view a size, so `<IsoWorld>` (which
 * draws nothing until then) never draws by another. Apart from `worldCameraView.svelte.ts` so a
 * runtime without the arcade family carries none of it. Default: isometric, zoom 1.
 */

import { ISO_PROJECTOR, type IsoProjector } from './projection';

const drawing = $state<{ projector: IsoProjector; zoom: number }>({
	projector: ISO_PROJECTOR,
	zoom: 1,
});

/** The projected world's projector and zoom (reactive). */
export const worldDrawing = (): { readonly projector: IsoProjector; readonly zoom: number } =>
	drawing;

/** Set the projector the projected world is drawn by (the world screen's `sceneProjector`). */
export const setWorldProjector = (projector: IsoProjector | undefined): void => {
	const next = projector ?? ISO_PROJECTOR;
	if (drawing.projector !== next) drawing.projector = next;
};

/** Set the camera's zoom (`engine-mechanics` `cameraZoom`; > 0, 1 draws as before). */
export const setWorldZoom = (zoom: number): void => {
	const next = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
	if (drawing.zoom !== next) drawing.zoom = next;
};
