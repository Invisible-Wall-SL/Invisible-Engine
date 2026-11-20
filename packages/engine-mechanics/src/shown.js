/**
 * WHAT A DEVICE'S SCREEN SHOWS, AND WHO A NEARBY ROOM SENDS IT BY
 * (`docs/design/realtime-multiplayer.md` §5, §11).
 *
 * A room with `arcade.online.nearby` sends a device only the players in a box about its own. A
 * window larger than the box was authored for shows more than that, and a phone less. So a device
 * says, on the inputs it already sends, how much of the world its screen shows about its own
 * player ({@link shownOf}: `shownW`, `shownH`, `shownIso`), and a room whose box names a `max`
 * sends by that, held inside the `max` box ({@link nearbyRegion}, {@link regionHolds}). A device
 * that says nothing, and every device of a room with no `max`, is sent by the box as before.
 *
 * It is a claim about a screen, never about the game: the step and the rules do not read it, and
 * the most it gets a device is the players inside `max`.
 *
 * Plain, dependency-free ESM for the reason `online.js` is: the room, the device and the gates
 * (`scripts/check-room-bots.mjs`, which pins the isometric test to `engine-layout`'s projection)
 * share this one file.
 */

import { zoomedView } from './camera.js';

/**
 * How an input's two sizes are read. `flat`: the world's x and y extents. `iso`: a 2:1 isometric
 * screen's across and down extents in world-projected px, where a world offset `(dx, dy)` is drawn
 * at `(dx − dy, (dx + dy) / 2)`; a mirrored screen draws `(dy − dx, …)`, the same region.
 */
export const SHOWN_SHAPE = Object.freeze({ flat: 0, iso: 1 });

/** A declared size is a whole number of these, px, so a camera at rest or drifting says the same
 *  thing on every input and the delta-encoded input stays a few bytes. */
export const SHOWN_GRID = 32;

/** The most a declared size carries: the last whole {@link SHOWN_GRID} of a uint16. */
export const SHOWN_MAX = 0xffff - (0xffff % SHOWN_GRID);

/** A size this close past a grid line (in grid steps) is on it: a view is made by divisions that
 *  are not exact, and 3240 px must not become the next step up on one device and not another. */
const GRID_SLACK = 1e-6;

const onGrid = (px) =>
	px > 0 ? Math.min(SHOWN_MAX, Math.ceil(px / SHOWN_GRID - GRID_SLACK) * SHOWN_GRID) : 0;

/**
 * What a device declares: the world its window shows, as the input's `{ shownW, shownH, shownIso }`.
 *
 * `window` is the window (the canvas) in CSS px, `windowScale` how many of them a design px is
 * drawn (the layout's main box scale) and `zoom` the design px a world px is drawn (`camera.js`
 * `cameraZoom`; 1 on a flat screen), so the view is `camera.js` `zoomedView` of the window in
 * design px: the camera's own arithmetic, on the window instead of the design box. `margin` is
 * added on every side (the room tests where a player stands; the screen shows its look). `off` is
 * how far the window's centre is from where the own player stands, in the same px as the sizes: a
 * room centres the region on the own player, so each size grows by twice it. Sizes are rounded up
 * to {@link SHOWN_GRID}. A window with no area declares nothing (0 × 0).
 */
export function shownOf({ window, windowScale = 1, zoom = 1, iso = false, margin = 0, off }) {
	const scale = windowScale > 0 ? windowScale : 1;
	const view = zoomedView({ w: window.w / scale, h: window.h / scale }, zoom);
	if (!(view.w > 0 && view.h > 0)) return { shownW: 0, shownH: 0, shownIso: SHOWN_SHAPE.flat };
	return {
		shownW: onGrid(view.w + 2 * (margin + Math.abs(off?.x ?? 0))),
		shownH: onGrid(view.h + 2 * (margin + Math.abs(off?.y ?? 0))),
		shownIso: iso ? SHOWN_SHAPE.iso : SHOWN_SHAPE.flat,
	};
}

/**
 * The region a room sends a device the players of, about its own player, `past` further out on
 * every limit (0: who comes in; the room's keep margin: who stays).
 *
 * `nearby` is the room's resolved `online.nearby` box. With no `max`, or a device that declared
 * nothing (`shown` absent or a size of 0: what `online.js` `sanitizeInput` leaves of anything
 * unreadable), the region is the box. Else it is the declared view inside the `max` box: a flat
 * view the smaller of the two on each axis; an isometric one the turned rectangle it declared, cut
 * by the `max` box.
 *
 * The limits are of `|dx|`, `|dy|`, `|dx − dy|` and `|dx + dy|` ({@link regionHolds}); a limit
 * that does not apply is `Infinity`.
 */
export function nearbyRegion(nearby, shown, past = 0) {
	const k = (1 + past) / 2;
	const max = nearby.max;
	if (!max || !shown || !(shown.shownW > 0 && shown.shownH > 0))
		return { x: nearby.w * k, y: nearby.h * k, across: Infinity, down: Infinity };
	if (shown.shownIso === SHOWN_SHAPE.iso)
		return { x: max.w * k, y: max.h * k, across: shown.shownW * k, down: shown.shownH * 2 * k };
	return {
		x: Math.min(shown.shownW, max.w) * k,
		y: Math.min(shown.shownH, max.h) * k,
		across: Infinity,
		down: Infinity,
	};
}

/** Whether `region` holds a player `dx`, `dy` world px from the device's own. */
export function regionHolds(region, dx, dy) {
	return (
		Math.abs(dx) <= region.x &&
		Math.abs(dy) <= region.y &&
		Math.abs(dx - dy) <= region.across &&
		Math.abs(dx + dy) <= region.down
	);
}
