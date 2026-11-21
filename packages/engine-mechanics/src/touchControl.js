/**
 * A TOUCH CONTROL SCHEME for an online player (`docs/design/arcade-touch-controls.md`): what a
 * finger's hold, tap and drag become, as data one character class is given and another can share.
 * It turns touches into the input the keys already make (a direction, a one-step press of the
 * class's tap button, an aim), so the room, its rules and its bots never learn of it.
 *
 * - **Hold to steer** (`gestures: 'hold' | 'both'`): while a finger is down the player keeps the
 *   heading from itself to the finger (`steer: 'finger'`), or the heading the finger was dragged
 *   from where it went down (`steer: 'stick'`). It never stops on reaching the point: inside the
 *   dead zone the heading is kept, and it is aimed again only once the finger has moved on by more
 *   than `tapPx`. Lifting stops it (`releaseStops`), or leaves it going.
 * - **Tap to head** (`gestures: 'tap' | 'both'`): a tap sets a heading the player keeps until the
 *   next tap, a hold, a tap on itself (within the dead zone: stop), a movement key, or a wall
 *   (no way made for {@link STALL_MS}).
 * - **A tap** is a press lifted within `tapPx` of where it went down and within `tapMs` (0: any
 *   length, the original Salmons').
 * - **The ability** (the class's tap button) is pressed, by `ability`: `tap` any tap (it heads as
 *   well, where taps head); `target` a tap the caller says is on a target (it does not head);
 *   `secondFinger` a tap of another finger while one is down; `button` the on-screen button only.
 *   `aim: 'point'` aims it where tapped, `'ahead'` leaves the aim to the caller (as a key does).
 *
 * The control works in canvas px and ms; the caller maps points onto the field each step
 * (`toField`), so a held finger keeps steering while the camera follows.
 *
 * Plain, dependency-free ESM beside `pointerControl.js`.
 */

import { pointerMove } from './pointerControl.js';

export const TOUCH_GESTURES = Object.freeze(['hold', 'tap', 'both']);
export const TOUCH_STEERS = Object.freeze(['finger', 'stick']);
export const TOUCH_ABILITY_PRESSES = Object.freeze(['tap', 'target', 'secondFinger', 'button']);
export const TOUCH_AIMS = Object.freeze(['point', 'ahead']);

/** What a scheme names when it names nothing. `deadZone` and `tapPx` are the game's own
 *  (`arcade.online.pointer`) where the caller has them. */
export const TOUCH_DEFAULTS = Object.freeze({
	gestures: 'hold',
	steer: 'finger',
	deadZone: 24,
	tapPx: 12,
	tapMs: 300,
	releaseStops: true,
	ability: 'tap',
	aim: 'point',
	targetRadius: 72,
});

/** A heading nobody holds is dropped once the player has made less than {@link STALL_PX} of way
 *  in this long: it met a wall. */
export const STALL_MS = 500;
export const STALL_PX = 4;

/** The most presses that wait to be taken: more are dropped. */
export const MAX_PRESSES = 2;

const pick = (list, value, fallback) => (list.includes(value) ? value : fallback);
const nonNegative = (value, fallback) => (Number.isFinite(value) && value >= 0 ? value : fallback);

/** `scheme` with every field named. */
export function resolveTouch(scheme = {}) {
	const d = TOUCH_DEFAULTS;
	return {
		gestures: pick(TOUCH_GESTURES, scheme.gestures, d.gestures),
		steer: pick(TOUCH_STEERS, scheme.steer, d.steer),
		deadZone: nonNegative(scheme.deadZone, d.deadZone),
		tapPx: nonNegative(scheme.tapPx, d.tapPx),
		tapMs: nonNegative(scheme.tapMs, d.tapMs),
		releaseStops: scheme.releaseStops !== false,
		ability: pick(TOUCH_ABILITY_PRESSES, scheme.ability, d.ability),
		aim: pick(TOUCH_AIMS, scheme.aim, d.aim),
		targetRadius: nonNegative(scheme.targetRadius, d.targetRadius),
	};
}

/**
 * A touch control for one player. `event(e, now)` takes `{ type: 'down' | 'move' | 'up' |
 * 'cancel', id, x, y }` of a finger or a pen in canvas px; `button()` is a press of the
 * on-screen button; `release()` forgets every finger, the heading and what waits (a lost focus, a
 * mouse or a key taking over); `held()` is whether a finger is down.
 *
 * `step(ctx)` is one fixed step. `ctx`: `self` the player's place on the field; `toField(point)`
 * a canvas point on the field (or `undefined`); `now` ms; `playing` (false while the player is
 * out or no round runs: touches then belong to the screens); `keys` a movement key is held;
 * `still` the room holds the player still (no wall is met then); `pressed` the last input already
 * pressed the button (a press waits a step for its release); `onTarget(fieldPoint)` whether a tap
 * there is on a target of the ability. It returns `{ move, press }`: `move` the heading as the
 * input's `{ moveX, moveY }` (absent: the fingers move nothing), `press` a one-step press of the
 * button with its `aim` on the field (absent: aim as a key).
 */
export function createTouchControl(scheme = {}) {
	const s = resolveTouch(scheme);
	const holds = s.gestures !== 'tap';
	const heads = s.gestures !== 'hold';
	/** The finger steering: `{ id, start, at, downAt, moved, reached }` (`reached`: where it was
	 *  when the player came to it). */
	let finger;
	/** Other fingers down while one steers, by id, oldest first. */
	const others = new Map();
	/** The heading kept, and where the player was when the wall clock last started. */
	let heading;
	let stall;
	/** Taps and presses not yet taken: `{ at?, acts, heads }`. */
	const waiting = [];
	const queue = (entry) => {
		if (waiting.length < MAX_PRESSES) waiting.push(entry);
	};

	const press = (e, now) => ({
		id: e.id,
		start: { x: e.x, y: e.y },
		at: { x: e.x, y: e.y },
		downAt: now,
		moved: false,
	});
	const moveTo = (p, e) => {
		p.at = { x: e.x, y: e.y };
		if (Math.hypot(p.at.x - p.start.x, p.at.y - p.start.y) > s.tapPx) p.moved = true;
	};
	const isTap = (p, now) => !p.moved && (s.tapMs === 0 || now - p.downAt <= s.tapMs);
	const setHeading = (move) => {
		heading = move.moveX || move.moveY ? move : undefined;
		stall = undefined;
	};

	return {
		event(e, now) {
			if (!e || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
			if (e.type === 'down') {
				// One finger steers. Another put down while it does is a tap in waiting: it takes
				// the steering over only by dragging (never under `secondFinger`), or when the
				// steering finger lifts.
				if (finger && finger.id !== e.id) others.set(e.id, press(e, now));
				else finger = press(e, now);
				return;
			}
			const other = others.get(e.id);
			if (other) {
				moveTo(other, e);
				if (e.type === 'move') {
					if (other.moved && s.ability !== 'secondFinger') {
						others.delete(e.id);
						others.set(finger.id, finger);
						finger = other;
					}
					return;
				}
				others.delete(e.id);
				if (e.type === 'up' && isTap(other, now))
					queue(
						s.ability === 'secondFinger'
							? { at: other.at, acts: true }
							: { at: other.at, tap: true },
					);
				return;
			}
			if (!finger || finger.id !== e.id) return;
			moveTo(finger, e);
			if (e.type === 'move') return;
			const tapped = e.type === 'up' && isTap(finger, now);
			const at = finger.at;
			// A finger still down takes the steering on: the player does not stop for it.
			finger = [...others.values()].at(-1);
			if (finger) {
				others.delete(finger.id);
				finger.reached = undefined;
			} else if (holds && s.releaseStops) setHeading({ moveX: 0, moveY: 0 });
			if (tapped) queue({ at, tap: true });
		},
		button() {
			queue({ acts: true });
		},
		release() {
			finger = undefined;
			others.clear();
			heading = undefined;
			stall = undefined;
			waiting.length = 0;
		},
		held: () => !!finger,
		step(ctx) {
			if (!ctx.playing) {
				// The fingers too: one put down on a screen is not a hold when play is back.
				finger = undefined;
				others.clear();
				heading = undefined;
				stall = undefined;
				waiting.length = 0;
				return {};
			}
			if (ctx.keys) setHeading({ moveX: 0, moveY: 0 });
			const steering = !!finger && holds && !ctx.keys;
			if (steering && s.steer === 'stick') {
				const move = finger.moved
					? pointerMove(ctx.toField(finger.start), ctx.toField(finger.at), 0)
					: undefined;
				if (move && (move.moveX || move.moveY)) setHeading(move);
			} else if (steering) {
				// Towards the finger, until the player is at it: from then the heading is kept, and
				// only a finger moved on by more than a tap's distance aims it again. So it never
				// stops at the point, and never turns back for it where the camera does not follow.
				const move = pointerMove(ctx.self, ctx.toField(finger.at), s.deadZone);
				const at = !(move.moveX || move.moveY);
				if (finger.reached) {
					const dx = finger.at.x - finger.reached.x;
					const dy = finger.at.y - finger.reached.y;
					if (Math.hypot(dx, dy) > s.tapPx) finger.reached = at ? finger.at : undefined;
				} else if (at) finger.reached = finger.at;
				if (!finger.reached) setHeading(move);
			}
			let pressed;
			const next = waiting[0];
			if (next) {
				const at = next.at && ctx.toField(next.at);
				const onTarget = s.ability === 'target' && !!at && !!ctx.onTarget?.(at);
				const acts = next.acts || (next.tap && (s.ability === 'tap' || onTarget));
				if (!(acts && ctx.pressed)) {
					waiting.shift();
					if (next.tap && heads && !onTarget && !ctx.keys && !finger && at && ctx.self)
						setHeading(pointerMove(ctx.self, at, s.deadZone));
					if (acts) pressed = { ...(at && s.aim === 'point' ? { aim: at } : {}) };
				}
			}
			if (heading && !steering && ctx.self) {
				if (ctx.still || !stall) stall = { at: ctx.self, since: ctx.now };
				else if (ctx.now - stall.since >= STALL_MS) {
					const made = Math.hypot(ctx.self.x - stall.at.x, ctx.self.y - stall.at.y);
					if (made < STALL_PX) heading = undefined;
					stall = heading ? { at: ctx.self, since: ctx.now } : undefined;
				}
			}
			return {
				...(heading ? { move: heading } : {}),
				...(pressed ? { press: pressed } : {}),
			};
		},
	};
}

/**
 * Keys that are down, with the ones pressed since the last step remembered: `held()` is the set
 * down now; `take()` is every code down now or pressed since the last `take()`, so a key pressed
 * and lifted between two fixed steps is still one step's press.
 */
export function createPressLatch() {
	const down = new Set();
	const since = new Set();
	return {
		press(code) {
			down.add(code);
			since.add(code);
		},
		lift(code) {
			down.delete(code);
		},
		clear() {
			down.clear();
			since.clear();
		},
		held: () => down,
		take() {
			const all = new Set([...down, ...since]);
			since.clear();
			return all;
		},
	};
}
