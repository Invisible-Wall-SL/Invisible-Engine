import { BUTTONS3D } from 'engine-mechanics/src/online3d.js';

import type { Stick3d } from './roomView';

/**
 * The 3D field's touch controls (3D review A N1; `docs/design/3d-games.md` Phase 2 input), with no
 * DOM and no Pixi: where the controls sit on a screen, which control a finger takes, and what the
 * fingers held this frame add up to. `src/touch.ts` draws them in the Pixi HUD and feeds it the
 * touches; the fixture gate (`scripts/check-engine-3d-touch.mjs`) plays it with numbers.
 *
 * - The **left half** is a floating stick: the base lands under the thumb, the knob follows it to
 *   the rim, and a thumb pushed past the rim runs ({@link BUTTONS3D} `sprint`).
 * - A finger on a **button** (bottom right: jump, attack, interact) holds its bit while it is down.
 * - Any other finger on the **right half** looks: its travel, in CSS px × {@link TOUCH_LOOK_GAIN},
 *   is the camera's look input, as a mouse drag's is (the director's `CameraInput3d`).
 *
 * Every output is the shape the keys give ({@link Stick3d} plus look travel), so the keys, these
 * controls and a gamepad merge into one input ({@link mergeSticks3d}).
 */

export type TouchButtonId3d = 'jump' | 'attack' | 'interact';

export type TouchButton3d = {
	id: TouchButtonId3d;
	label: string;
	/** The input's button bit it holds. */
	bit: number;
	x: number;
	y: number;
	r: number;
};

/** Where the controls sit on a `width` × `height` screen (CSS px, origin top left). */
export type TouchLayout3d = {
	width: number;
	height: number;
	/** The stick's travel to the rim, px. */
	stickRadius: number;
	/** Where the stick rests, drawn, while no thumb holds it. */
	stickHome: { x: number; y: number };
	buttons: readonly TouchButton3d[];
};

/** One frame of the fingers: the stick (camera-relative) and buttons, and the look travel since the
 *  last read. */
export type TouchFrame3d = Stick3d & { lookX: number; lookY: number };

/** What the controls show now: the stick (held or at rest) and the buttons held. */
export type TouchView3d = {
	stick: {
		base: { x: number; y: number };
		knob: { x: number; y: number };
		held: boolean;
		run: boolean;
	};
	pressed: ReadonlySet<TouchButtonId3d>;
};

/**
 * Look travel per CSS px of a finger, in the mouse's units: a first-person rig turns 0.2° a px, so a
 * mouse needs 900 px for a half turn; a thumb on a phone has about 200, so it turns 2.5× as far.
 */
export const TOUCH_LOOK_GAIN = 2.5;

/** A stick held nearer its centre than this share of the rim is at rest. */
export const STICK_DEAD_ZONE = 0.15;

/** A thumb this far past the rim (a share of the radius) starts a run; back inside the rim ends it. */
export const STICK_RUN_AT = 1.15;

/** The share of the screen's width, from the left, where a finger takes the stick. */
const STICK_SHARE = 0.5;

/** A finger this much wider than a button (a share of its radius) still presses it. */
const BUTTON_SLOP = 1.2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The controls on a `width` × `height` screen. One unit (a seventh of the short side, 44–84 px)
 * sizes them, so a phone gets thumb-sized controls and a tablet does not get saucers.
 */
export function touchLayout3d(width: number, height: number): TouchLayout3d {
	const unit = clamp(Math.min(width, height) / 7, 44, 84);
	const margin = unit * 0.5;
	const stickRadius = unit * 1.1;
	const jump = { r: unit * 0.8 };
	const small = unit * 0.62;
	const gap = unit * 0.3;
	const jx = width - margin - jump.r;
	const jy = height - margin - jump.r;
	// The small buttons sit on an arc round jump: interact straight above it, attack up and to the
	// left (30° above level), so even a narrow portrait phone keeps them on the right half.
	const arc = jump.r + gap + small;
	return {
		width,
		height,
		stickRadius,
		stickHome: { x: margin + stickRadius, y: height - margin - stickRadius },
		buttons: [
			{ id: 'jump', label: 'Jump', bit: BUTTONS3D.jump, x: jx, y: jy, r: jump.r },
			{
				id: 'attack',
				label: 'Hit',
				bit: BUTTONS3D.attack,
				x: jx - arc * Math.cos(Math.PI / 6),
				y: jy - arc * Math.sin(Math.PI / 6),
				r: small,
			},
			{ id: 'interact', label: 'Grab', bit: BUTTONS3D.interact, x: jx, y: jy - arc, r: small },
		],
	};
}

type Finger =
	| { kind: 'stick'; base: { x: number; y: number }; at: { x: number; y: number }; run: boolean }
	| { kind: 'button'; id: TouchButtonId3d }
	| { kind: 'look'; last: { x: number; y: number } }
	/** A look finger a newer one replaced: still owned (it must not aim), contributes nothing. */
	| { kind: 'spent' };

export type Touch3d = {
	/** The screen changed size (CSS px). */
	resize(width: number, height: number): void;
	/** A finger came down at (`x`, `y`): `true` when a control takes it. */
	down(id: number, x: number, y: number): boolean;
	move(id: number, x: number, y: number): void;
	/** A finger lifted or was cancelled. */
	up(id: number): void;
	/** Every finger let go (the page lost focus, the stage went away). */
	clear(): void;
	owns(id: number): boolean;
	/** This frame's input; the look travel is consumed. */
	read(): TouchFrame3d;
	view(): TouchView3d;
	layout(): TouchLayout3d;
};

export function createTouch3d(width: number, height: number): Touch3d {
	let layout = touchLayout3d(width, height);
	const fingers = new Map<number, Finger>();
	let lookX = 0;
	let lookY = 0;

	const stickFinger = () => {
		for (const f of fingers.values()) if (f.kind === 'stick') return f;
		return undefined;
	};
	/** The stick's deflection: unit direction × magnitude (0 in the dead zone, 1 at the rim). */
	const deflection = (f: Finger & { kind: 'stick' }) => {
		const dx = f.at.x - f.base.x;
		const dy = f.at.y - f.base.y;
		const dist = Math.hypot(dx, dy);
		const share = dist / layout.stickRadius;
		const mag =
			share <= STICK_DEAD_ZONE ? 0 : Math.min(1, (share - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE));
		return { ux: dist ? dx / dist : 0, uy: dist ? dy / dist : 0, dist, share, mag };
	};

	return {
		resize(w, h) {
			layout = touchLayout3d(w, h);
		},
		down(id, x, y) {
			const button = layout.buttons.find((b) => Math.hypot(x - b.x, y - b.y) <= b.r * BUTTON_SLOP);
			if (button) {
				fingers.set(id, { kind: 'button', id: button.id });
				return true;
			}
			if (x < layout.width * STICK_SHARE) {
				if (stickFinger()) return false;
				// The base lands under the thumb, kept a radius inside the screen's edges.
				const r = layout.stickRadius;
				const base = { x: clamp(x, r, layout.width - r), y: clamp(y, r, layout.height - r) };
				fingers.set(id, { kind: 'stick', base, at: { x, y }, run: false });
				return true;
			}
			// The newest look finger looks; an older one is kept but spent.
			for (const [other, f] of fingers)
				if (f.kind === 'look') fingers.set(other, { kind: 'spent' });
			fingers.set(id, { kind: 'look', last: { x, y } });
			return true;
		},
		move(id, x, y) {
			const f = fingers.get(id);
			if (!f) return;
			if (f.kind === 'stick') {
				f.at = { x, y };
				const { share } = deflection(f);
				if (share >= STICK_RUN_AT) f.run = true;
				else if (share < 1) f.run = false;
			} else if (f.kind === 'look') {
				lookX += (x - f.last.x) * TOUCH_LOOK_GAIN;
				lookY += (y - f.last.y) * TOUCH_LOOK_GAIN;
				f.last = { x, y };
			}
		},
		up(id) {
			fingers.delete(id);
		},
		clear() {
			fingers.clear();
			lookX = lookY = 0;
		},
		owns: (id) => fingers.has(id),
		read() {
			let right = 0;
			let forward = 0;
			let buttons = 0;
			for (const f of fingers.values()) {
				if (f.kind === 'button') buttons |= layout.buttons.find((b) => b.id === f.id)?.bit ?? 0;
				else if (f.kind === 'stick') {
					const d = deflection(f);
					right = d.ux * d.mag;
					// Screen up is forward.
					forward = -d.uy * d.mag;
					if (f.run && d.mag > 0) buttons |= BUTTONS3D.sprint;
				}
			}
			const frame = { right: right + 0, forward: forward + 0, buttons, lookX, lookY };
			lookX = lookY = 0;
			return frame;
		},
		view() {
			const f = stickFinger();
			const pressed = new Set<TouchButtonId3d>();
			for (const g of fingers.values()) if (g.kind === 'button') pressed.add(g.id);
			if (!f) {
				const home = layout.stickHome;
				return { stick: { base: home, knob: home, held: false, run: false }, pressed };
			}
			const d = deflection(f);
			const reach = Math.min(d.dist, layout.stickRadius);
			return {
				stick: {
					base: f.base,
					knob: { x: f.base.x + d.ux * reach, y: f.base.y + d.uy * reach },
					held: true,
					run: f.run,
				},
				pressed,
			};
		},
		layout: () => layout,
	};
}

/**
 * Several devices' input as one stick (keys, touch, a gamepad): the axes add, each held to ±1, and
 * the buttons join. The length is left to the move (`moveAxes`, the room's `moveFromStick`), which
 * clamps it as it always has, so the keys alone give exactly what they gave before.
 */
export function mergeSticks3d(first: Stick3d, ...rest: readonly Stick3d[]): Stick3d {
	let { right, forward, buttons } = first;
	for (const s of rest) {
		right += s.right;
		forward += s.forward;
		buttons |= s.buttons;
	}
	return { right: clamp(right, -1, 1), forward: clamp(forward, -1, 1), buttons };
}
