/**
 * WHAT A DEVICE'S SCREEN SHOWS, AND WHO A NEARBY ROOM SENDS IT BY
 * (`docs/design/realtime-multiplayer.md` §5, §11).
 *
 * A room with `arcade.online.nearby` sends a device the players in a box about its own
 * ({@link boxRegion}). A window larger than the box was authored for shows more than that. So a
 * device says, on the inputs it already sends, how much of the world its screen shows about its
 * own player ({@link shownOf}: `shownW`, `shownH`, `shownIso`), and a room whose box names a `max`
 * sends it the players in that view too, as far as the `max` box ({@link viewRegion}).
 *
 * THE VIEW ONLY ADDS TO THE BOX. A device is sent a player in the box or in its view, never less
 * than the box whatever it says: the box is what a game's rules may count on (whoever can reach a
 * player is in that player's state), so a room with a `max` sends every device at least what one
 * without it sends. A device that says nothing, a bot, and every device of a room with no `max`
 * have the box alone.
 *
 * A VIEW IS HELD ({@link holdView}): a player that comes into a view is sent in full, so a device
 * that kept saying a small view and a large one in turn would be sent everyone again and again.
 * The room sends by the widest view said in the hold window before this one or so far in this
 * one: a view grows at once and shrinks at most once a window.
 *
 * It is a claim about a screen, never about the game: the step and the rules do not read it. The
 * `max` box bounds who comes into a view; as with the box, a player already sent stays until it
 * is the room's keep margin past it ({@link pastRegion}).
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
 * What a device declares: the world its window shows, as the input's `shownW`, `shownH` and
 * `shownIso`.
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
 * A region about a device's own player is four limits, of `|dx|`, `|dy|`, `|dx − dy|` and
 * `|dx + dy|` ({@link regionHolds}); a limit that does not apply is `Infinity`.
 *
 * The room's `online.nearby` box as one, `past` further out on every side (0: who comes in; the
 * room's keep margin: who stays).
 */
export function boxRegion(nearby, past = 0) {
	const k = (1 + past) / 2;
	return { x: nearby.w * k, y: nearby.h * k, across: Infinity, down: Infinity };
}

/**
 * The view a device declares, as a region: what its input says inside the `max` box of the room's
 * resolved `online.nearby`. A flat view is the smaller of the two on each axis; an isometric one
 * the turned rectangle it declared, cut by the `max` box. `undefined` (no view: the box alone)
 * when the box names no `max` or the device said nothing (`shown` absent or a size of 0: what
 * `online.js` `sanitizeInput` leaves of anything unreadable).
 */
export function viewRegion(nearby, shown) {
	const max = nearby.max;
	if (!max || !shown || !(shown.shownW > 0 && shown.shownH > 0)) return undefined;
	if (shown.shownIso === SHOWN_SHAPE.iso)
		return { x: max.w / 2, y: max.h / 2, across: shown.shownW / 2, down: shown.shownH };
	return {
		x: Math.min(shown.shownW, max.w) / 2,
		y: Math.min(shown.shownH, max.h) / 2,
		across: Infinity,
		down: Infinity,
	};
}

/** `region` with every limit `past` further out (no region stays none). */
export function pastRegion(region, past) {
	const k = 1 + past;
	return (
		region && {
			x: region.x * k,
			y: region.y * k,
			across: region.across * k,
			down: region.down * k,
		}
	);
}

/**
 * A region that holds whatever `a` holds and whatever `b` holds: each limit the larger (either
 * may be none). A flat view and an isometric one widen to a box: for two views of one room, the
 * `max` box.
 */
export function widestRegion(a, b) {
	if (!a || !b) return a ?? b;
	return {
		x: Math.max(a.x, b.x),
		y: Math.max(a.y, b.y),
		across: Math.max(a.across, b.across),
		down: Math.max(a.down, b.down),
	};
}

/**
 * ONE PATCH OF A DEVICE'S HELD VIEW. `hold` is what the last call returned (`undefined` before
 * the first), `view` the region the device's newest input declares ({@link viewRegion}) and
 * `patches` the hold window's length. Returns the next hold; its `view` is what the room sends
 * by: the widest view declared in the window before this one or so far in this one.
 *
 * So a larger view counts from the patch it is said in, and a smaller one only once a whole
 * window has passed with nothing larger said: between one window and two after the last larger
 * one. A device that says nothing for that long has no view again.
 */
export function holdView(hold, view, patches) {
	const turn = !hold || hold.left <= 0;
	const before = turn ? hold?.widest : hold.before;
	const widest = widestRegion(turn ? undefined : hold.widest, view);
	return {
		before,
		widest,
		left: (turn ? patches : hold.left) - 1,
		view: widestRegion(before, widest),
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

/**
 * Whether a device is sent a player `dx`, `dy` world px from its own: one its `box` holds or its
 * `view` holds (no view: the box alone). The one place the two are put together, so the view can
 * only add.
 */
export function nearbyHolds(box, view, dx, dy) {
	return regionHolds(box, dx, dy) || (view !== undefined && regionHolds(view, dx, dy));
}
