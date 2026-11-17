/**
 * Mouse and touch control of an online player (`docs/design/arcade-pointer-controller.md`): what a
 * press, a hover, a tap and a drag do, as the original Salmons' client did them
 * (`GuiltyForever/Salmon-` `client/input.js`, `client/game.js` `tick`).
 *
 * - **A finger steers while it is down:** the player heads for the point under it at full speed
 *   and stops within a dead zone of it; lifting it stops the player.
 * - **A mouse steers by hovering** (`mouse: 'hover'`, the original's): the player heads for the
 *   cursor whenever the mouse has been used last, button or not. With `mouse: 'press'` a mouse is
 *   a finger: it steers only while its button is held.
 * - **A tap** (a finger, or a pressed mouse, lifted no more than `tapPx` from where it went down)
 *   is the character's action at that point. A hovering mouse's press is the action at once.
 * - **Multi-touch:** the newest finger steers; an older one still down does nothing, and when the
 *   steering finger lifts nobody steers until the next press (the original kept one touch id and a
 *   new touch took it over).
 *
 * The tracker works in canvas px; the caller maps its points onto the field (through the camera
 * and the projection) each step, so a held finger keeps steering while the camera follows.
 * {@link pointerMove} turns a field point into the input's whole-number move: a direction, never a
 * position, so the room stays the only one that moves a player.
 *
 * Plain, dependency-free ESM beside `online.js`.
 */

import { MOVE_SCALE } from './online.js';

/** How a mouse steers: by hovering (no button) or only while pressed. */
export const POINTER_MOUSE_MODES = Object.freeze(['hover', 'press']);

/** What a pointer control names when it names nothing. */
export const POINTER_DEFAULTS = Object.freeze({
	mouse: 'press',
	deadZone: 24,
	tapPx: 12,
});

const isTouchLike = (kind) => kind !== 'mouse';

/**
 * A pointer tracker for one canvas. `event(e)` takes `{ type: 'down' | 'move' | 'up' | 'cancel',
 * id, kind: 'mouse' | 'touch' | 'pen', x, y, button? }` in canvas px; `target()` is the point
 * steering now (or `undefined`); `takeTap()` hands over the oldest tap not yet taken (or
 * `undefined`); `release()` forgets every press (a lost focus).
 */
export function createPointerTracker(options = {}) {
	const mouse = POINTER_MOUSE_MODES.includes(options.mouse)
		? options.mouse
		: POINTER_DEFAULTS.mouse;
	const tapPx = Math.max(0, options.tapPx ?? POINTER_DEFAULTS.tapPx);
	/** The press steering now: `{ id, start, at, moved }`. */
	let press;
	/** Where the mouse was last seen, and whether the mouse was used after the last touch. */
	let hover;
	let usingMouse = false;
	const taps = [];

	const point = (e) => ({ x: e.x, y: e.y });
	const begin = (e) => {
		press = { id: e.id, start: point(e), at: point(e), moved: false };
	};
	const end = (e, tapping) => {
		if (!press || press.id !== e.id) return;
		press.at = point(e);
		if (tapping && !press.moved) taps.push(press.at);
		press = undefined;
	};
	const moveTo = (e) => {
		if (!press || press.id !== e.id) return;
		press.at = point(e);
		const dx = press.at.x - press.start.x;
		const dy = press.at.y - press.start.y;
		if (Math.hypot(dx, dy) > tapPx) press.moved = true;
	};

	return {
		event(e) {
			if (!e || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
			if (isTouchLike(e.kind)) {
				if (e.type === 'down') {
					usingMouse = false;
					begin(e);
				} else if (e.type === 'move') moveTo(e);
				else end(e, e.type === 'up');
				return;
			}
			if (e.type === 'move') {
				usingMouse = true;
				hover = point(e);
				moveTo(e);
				return;
			}
			if ((e.button ?? 0) !== 0) return;
			if (e.type === 'down') {
				usingMouse = true;
				hover = point(e);
				if (mouse === 'hover') taps.push(point(e));
				else begin(e);
			} else end(e, e.type === 'up');
		},
		target() {
			if (press) return press.at;
			return mouse === 'hover' && usingMouse ? hover : undefined;
		},
		takeTap() {
			return taps.shift();
		},
		release() {
			press = undefined;
			taps.length = 0;
		},
	};
}

/**
 * The move that heads `self` for `target` (field px) at full tilt: whole numbers no longer than
 * {@link MOVE_SCALE}, `{ moveX: 0, moveY: 0 }` within `deadZone` of it or with no target.
 */
export function pointerMove(self, target, deadZone = POINTER_DEFAULTS.deadZone) {
	if (!self || !target) return { moveX: 0, moveY: 0 };
	const dx = target.x - self.x;
	const dy = target.y - self.y;
	const d = Math.hypot(dx, dy);
	if (!(d > 0) || d < Math.max(0, deadZone)) return { moveX: 0, moveY: 0 };
	let moveX = Math.round((dx / d) * MOVE_SCALE);
	let moveY = Math.round((dy / d) * MOVE_SCALE);
	if (moveX * moveX + moveY * moveY > MOVE_SCALE * MOVE_SCALE) {
		moveX = Math.trunc((dx / d) * MOVE_SCALE);
		moveY = Math.trunc((dy / d) * MOVE_SCALE);
	}
	return { moveX, moveY };
}
