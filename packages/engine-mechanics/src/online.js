/**
 * Online arcade rooms (`docs/design/realtime-multiplayer.md` §5, §6, §11; P10.14, P10.15): what a
 * player's input is, how it is clamped, and the one-player step it drives.
 *
 * Plain, dependency-free ESM beside `motion.js`, for the reason that file is: the game server
 * (`services/game-server`) steps every player with {@link stepPlayer}, and a device that predicts
 * its own player (P10.15) steps it with the very same function, so the two can only disagree if
 * they were given different inputs.
 *
 * An input is `{ seq, moveX, moveY, buttons, aimX, aimY, view }` and nothing else: no position, no
 * hit, no score. `view` is the room step the device was drawing everyone else at (P10.15), so the
 * server can test an ability against what its player saw; the server holds it to its own window.
 * `moveX` / `moveY` are whole numbers in -{@link MOVE_SCALE}..{@link MOVE_SCALE} (a stick at full
 * tilt is 127) whose length is at most {@link MOVE_SCALE}, so the clamp is exact and
 * idempotent: a clamped input clamps to itself, on either side of the wire. `buttons` is a
 * bitfield of {@link BUTTONS}; `aim` is a point on the field.
 *
 * A step with no input moves its player by nothing: the player stands still until the next input
 * arrives (a body has no momentum: the step sets its velocity to 0). A level's currents
 * ({@link onlineLevel}) push a player only on a step that applies an input, so a player's body is
 * still exactly the fold of {@link stepPlayer} over the inputs the server applied, in `seq` order —
 * what `scripts/check-room-sim.mjs` pins and what a predicting device replays (`netcode.js`).
 */

import { aabbOf, createStaticIndex, inZone, queryStatic, stepBody } from './motion.js';

/** A full-tilt move along one axis. */
export const MOVE_SCALE = 127;

/** The input's buttons. */
export const BUTTONS = Object.freeze({ jump: 1, ability1: 2, ability2: 4 });

const BUTTON_MASK = BUTTONS.jump | BUTTONS.ability1 | BUTTONS.ability2;

const UINT32_MAX = 0xffffffff;

/** The longest name a room keeps, in characters. */
const NAME_LENGTH = 24;

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const towardZero = (v) => (v < 0 ? Math.ceil(v) : Math.floor(v));

const uint32 = (v) => {
	const n = Math.floor(finite(v));
	return n < 0 ? 0 : n > UINT32_MAX ? UINT32_MAX : n;
};

/**
 * Clamp an input in place: `seq` and `view` to whole uint32s, the move to whole steps no longer than
 * {@link MOVE_SCALE}, `buttons` to the known bits, `aim` onto the field. Anything that is not a
 * finite number reads as 0. Returns the input.
 */
export function sanitizeInput(input, field) {
	input.seq = uint32(input.seq);
	let mx = Math.round(finite(input.moveX));
	let my = Math.round(finite(input.moveY));
	mx = Math.max(-MOVE_SCALE, Math.min(MOVE_SCALE, mx));
	my = Math.max(-MOVE_SCALE, Math.min(MOVE_SCALE, my));
	const limit = MOVE_SCALE * MOVE_SCALE;
	if (mx * mx + my * my > limit) {
		const scale = MOVE_SCALE / Math.sqrt(mx * mx + my * my);
		mx = towardZero(mx * scale);
		my = towardZero(my * scale);
		while (mx * mx + my * my > limit) {
			if (Math.abs(mx) >= Math.abs(my)) mx -= Math.sign(mx);
			else my -= Math.sign(my);
		}
	}
	input.moveX = mx + 0;
	input.moveY = my + 0;
	input.buttons = Math.floor(finite(input.buttons)) & BUTTON_MASK;
	const w = field ? field.w : Infinity;
	const h = field ? field.h : Infinity;
	input.aimX = Math.fround(Math.max(0, Math.min(w, Math.fround(finite(input.aimX)))));
	input.aimY = Math.fround(Math.max(0, Math.min(h, Math.fround(finite(input.aimY)))));
	input.view = uint32(input.view);
	return input;
}

/** A new, clamped input from anything (`{}` is a resting input at seq 0). */
export function clampInput(raw, field) {
	const src = raw && typeof raw === 'object' ? raw : {};
	return sanitizeInput(
		{
			seq: src.seq,
			moveX: src.moveX,
			moveY: src.moveY,
			buttons: src.buttons,
			aimX: src.aimX,
			aimY: src.aimY,
			view: src.view,
		},
		field,
	);
}

/** The fixed step a room advertises: `dt` = one step, `subDt` = one physics sub-step, in seconds.
 *  `subDt` is computed as Colyseus' `setFixedTimestep` computes it, so both sides agree to the bit. */
export function stepContext(tickHz, subSteps = 1) {
	const dt = 1 / tickHz;
	return { dt, subSteps, subDt: dt / subSteps };
}

/** Set a body's velocity from an input (or rest, with none) at `speed` px/s. */
function applyInput(body, input, speed) {
	body.vx = input ? (input.moveX / MOVE_SCALE) * speed : 0;
	body.vy = input ? (input.moveY / MOVE_SCALE) * speed : 0;
	return body;
}

/**
 * One fixed step of one player: the input sets its velocity, then `subSteps` motion steps of
 * `subDt` move it and hold it to the field. `input` undefined = the step had no input, and the
 * player stands still. With a `level`, each sub-step of an input's step adds the force of every
 * current the body is in to that velocity.
 */
export function stepPlayer(body, input, speed, ctx, field, level) {
	applyInput(body, input, speed);
	const currents = input && level?.currents.shapes.length ? level.currents : undefined;
	if (!currents) {
		for (let i = 0; i < ctx.subSteps; i++) stepBody(body, ctx.subDt, field);
		return body;
	}
	const vx = body.vx;
	const vy = body.vy;
	for (let i = 0; i < ctx.subSteps; i++) {
		body.vx = vx;
		body.vy = vy;
		for (const zone of queryStatic(currents, aabbOf(body))) {
			if (!inZone(body, zone)) continue;
			body.vx += zone.fx;
			body.vy += zone.fy;
		}
		stepBody(body, ctx.subDt, field);
	}
	body.vx = vx;
	body.vy = vy;
	return body;
}

/** A zone held to the field, or `undefined` when none of it is on the field: the server indexes
 *  only what a player can reach, however large the config draws it. */
export function clipToField(zone, field) {
	const x0 = Math.max(0, zone.x);
	const y0 = Math.max(0, zone.y);
	const x1 = Math.min(field.w, zone.x + zone.w);
	const y1 = Math.min(field.h, zone.y + zone.h);
	if (!(x1 > x0 && y1 > y0)) return undefined;
	return { ...zone, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The grid cell a level of this field is indexed in: at most 64 cells a side, however large. */
export const levelCell = (field) => Math.max(128, Math.ceil(Math.max(field.w, field.h) / 64));

/**
 * What of a level moves a player of `character`: its currents, the zones of `arcade.zones` that an
 * `arcade.online.rules.zones` entry gives a force and that apply to the character (every one when
 * the rule names none), held to the field and indexed once. The server and a predicting device build
 * it from the same config, so both push the player alike.
 */
export function onlineLevel(zones, rules, character, field) {
	const byId = new Map((zones ?? []).map((zone) => [zone.id, zone]));
	const currents = [];
	for (const rule of rules ?? []) {
		const zone = byId.get(rule.zone);
		if (!zone || !rule.force) continue;
		if (rule.characters && !rule.characters.includes(character)) continue;
		const clipped = clipToField(zone, field);
		if (!clipped) continue;
		const { id, x, y, w, h } = clipped;
		currents.push({ id, x, y, w, h, fx: rule.force.x, fy: rule.force.y });
	}
	return { currents: createStaticIndex(currents, levelCell(field)) };
}

/**
 * Which of eight ways a move faces (0 = right, then clockwise with y down: 2 = down, 4 = left,
 * 6 = up), or `previous` for no move. Integer comparisons only, so it is the same everywhere.
 */
export function facingOf(input, previous = 0) {
	const mx = input ? input.moveX : 0;
	const my = input ? input.moveY : 0;
	if (mx === 0 && my === 0) return previous;
	const ax = Math.abs(mx);
	const ay = Math.abs(my);
	const sx = ax * 5 > ay * 2 ? Math.sign(mx) : 0;
	const sy = ay * 5 > ax * 2 ? Math.sign(my) : 0;
	return FACING[(sy + 1) * 3 + (sx + 1)];
}

/** `(sy, sx)` from -1..1 → facing; the centre is never read. */
const FACING = [5, 6, 7, 4, 0, 0, 3, 2, 1];

/** A player's name as a room keeps it: control, zero-width and bidi-override characters dropped
 *  (every player sees it), trimmed, capped. */
export function cleanName(raw) {
	if (typeof raw !== 'string') return '';
	const text = raw
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
		.trim();
	return [...text].slice(0, NAME_LENGTH).join('');
}

/**
 * A player's body: the shape, tags and edges of its character's arcade body (`{ shape, w, h }`,
 * `{ shape, r }`, else a point), at rest at `at`.
 */
export function characterBody(id, spec, at) {
	const body = {
		id,
		x: at.x,
		y: at.y,
		vx: 0,
		vy: 0,
		tags: [...(spec?.tags ?? [])],
		shape: 'point',
	};
	if (spec?.edges) body.edges = spec.edges;
	if (spec?.shape === 'box') Object.assign(body, { shape: 'box', w: spec.w, h: spec.h });
	else if (spec?.shape === 'circle') Object.assign(body, { shape: 'circle', r: spec.r });
	return body;
}
