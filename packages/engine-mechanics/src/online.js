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
 * It may also say what its screen shows (`shownW`, `shownH`, `shownIso`: `shown.js`), which adds
 * to who a nearby room sends it and is never read by {@link stepPlayer} or the rules.
 * `moveX` / `moveY` are whole numbers in -{@link MOVE_SCALE}..{@link MOVE_SCALE} (a stick at full
 * tilt is 127) whose length is at most {@link MOVE_SCALE}, so the clamp is exact and
 * idempotent: a clamped input clamps to itself, on either side of the wire. `buttons` is a
 * bitfield of {@link BUTTONS}; `aim` is a point on the field. A person may add `respawn` (`1 +` the
 * index of the character it picked, at most {@link RESPAWN_MAX}; 0 none), read only while the room
 * waits for it to press Respawn (it was caught) or lets its people pick (a lobby before round 1).
 *
 * A step with no input moves its player by nothing: the player stands still until the next input
 * arrives (a body has no momentum: the step sets its velocity to 0). A level's currents
 * ({@link onlineLevel}) push a player only on a step that applies an input, so a player's body is
 * still exactly the fold of {@link stepPlayer} over the inputs the server applied, in `seq` order —
 * what `scripts/check-room-sim.mjs` pins and what a predicting device replays (`netcode.js`).
 */

import { addZoneForces, zoneForces } from './abilities.js';
import { aabbOf, createStaticIndex, queryStatic, stepBody, stepSlide } from './motion.js';

/** A full-tilt move along one axis. */
export const MOVE_SCALE = 127;

/** The input's buttons. */
export const BUTTONS = Object.freeze({ jump: 1, ability1: 2, ability2: 4 });

const BUTTON_MASK = BUTTONS.jump | BUTTONS.ability1 | BUTTONS.ability2;

const UINT32_MAX = 0xffffffff;

/** The highest `respawn` an input carries: the character list's own cap (a uint8 on the wire). */
export const RESPAWN_MAX = 16;

/** The longest name a room keeps, in characters. */
export const NAME_LENGTH = 24;

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const towardZero = (v) => (v < 0 ? Math.ceil(v) : Math.floor(v));

const uint32 = (v) => {
	const n = Math.floor(finite(v));
	return n < 0 ? 0 : n > UINT32_MAX ? UINT32_MAX : n;
};

const UINT16_MAX = 0xffff;

const uint16 = (v) => {
	const n = Math.floor(finite(v));
	return n < 0 ? 0 : n > UINT16_MAX ? UINT16_MAX : n;
};

const declares = (input) =>
	input.shownW !== undefined || input.shownH !== undefined || input.shownIso !== undefined;

/**
 * Clamp an input in place: `seq` and `view` to whole uint32s, the move to whole steps no longer than
 * {@link MOVE_SCALE}, `buttons` to the known bits, `aim` onto the field. Anything that is not a
 * finite number reads as 0; `respawn`, when the input has one, to 0..{@link RESPAWN_MAX}. Returns the
 * input. {@link clampInput} always gives `respawn` (0 for none), so an input written over a kept one
 * clears it.
 *
 * What the screen shows, when the input says anything of it: `shownW` and `shownH` to whole
 * uint16s and `shownIso` to 0 or 1, all three 0 (nothing declared) unless both sizes are above 0
 * and the shape is one of the two. The wire carries a uint16 and a uint8 of any value, so a size
 * a device's encoder wrapped is simply a size, and a shape of 2..255 declares nothing.
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
	if (input.respawn !== undefined) {
		const n = Math.floor(finite(input.respawn));
		input.respawn = n < 0 || n > RESPAWN_MAX ? 0 : n;
	}
	if (declares(input)) {
		const shownW = uint16(input.shownW);
		const shownH = uint16(input.shownH);
		const shape = input.shownIso;
		const declared = shownW > 0 && shownH > 0 && (shape === 0 || shape === 1);
		input.shownW = declared ? shownW : 0;
		input.shownH = declared ? shownH : 0;
		input.shownIso = declared ? shape : 0;
	}
	return input;
}

/** A new, clamped input from anything (`{}` is a resting input at seq 0). What the screen shows
 *  is carried only when `raw` says anything of it. */
export function clampInput(raw, field) {
	const src = raw && typeof raw === 'object' ? raw : {};
	const input = {
		seq: src.seq,
		moveX: src.moveX,
		moveY: src.moveY,
		buttons: src.buttons,
		aimX: src.aimX,
		aimY: src.aimY,
		view: src.view,
		respawn: src.respawn,
	};
	if (declares(src)) {
		input.shownW = src.shownW;
		input.shownH = src.shownH;
		input.shownIso = src.shownIso;
	}
	return sanitizeInput(input, field);
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
 * current the body is in to that velocity, and stops the body at the level's solids
 * ({@link moveAgainstSolids}, with the level's `slide` when it has one).
 */
export function stepPlayer(body, input, speed, ctx, field, level) {
	applyInput(body, input, speed);
	const currents = input && level?.currents.shapes.length ? level.currents : undefined;
	const solids = input && level?.solids?.shapes.length ? level.solids : undefined;
	if (!currents && !solids) {
		for (let i = 0; i < ctx.subSteps; i++) stepBody(body, ctx.subDt, field);
		return body;
	}
	const vx = body.vx;
	const vy = body.vy;
	for (let i = 0; i < ctx.subSteps; i++) {
		body.vx = vx;
		body.vy = vy;
		if (currents) addZoneForces(body, currents, undefined, ctx.subDt);
		if (solids) moveAgainstSolids(body, ctx.subDt, solids, field, level.slide);
		else stepBody(body, ctx.subDt, field);
	}
	body.vx = vx;
	body.vy = vy;
	return body;
}

/**
 * The input a player CARRYING A MOVE is stepped with (Salmons' leap: the original keeps a leaping
 * salmon's velocity until it steers). `carry` is `{ air, carryX, carryY }`, mutated: while `air`
 * (inputs left to carry for) is above 0, each input spends one; a move of 0 is replaced by the
 * carried one, any other move is stepped as it is and carried from then on; the carry is 0 once
 * `air` is. With no `air`, or no input, the input itself. Integers only: the room and a predicting
 * device fold it alike.
 */
export function carriedInput(carry, input) {
	if (!input || !(carry.air > 0)) return input;
	carry.air -= 1;
	let stepped = input;
	if (input.moveX !== 0 || input.moveY !== 0) {
		carry.carryX = input.moveX;
		carry.carryY = input.moveY;
	} else stepped = { ...input, moveX: carry.carryX ?? 0, moveY: carry.carryY ?? 0 };
	if (carry.air === 0) {
		carry.carryX = 0;
		carry.carryY = 0;
	}
	return stepped;
}

/** A body this close to a one-way solid's side, px, is on that side. */
const ONE_WAY_EPSILON = 1e-6;

/** Whether `box` is wholly on the side of `solid` it blocks from (`solid.from`). */
const onBlockedSide = (box, solid) => {
	const s = solid.box;
	switch (solid.from) {
		case 'below':
			return box.y0 >= s.y1 - ONE_WAY_EPSILON;
		case 'above':
			return box.y1 <= s.y0 + ONE_WAY_EPSILON;
		case 'left':
			return box.x1 <= s.x0 + ONE_WAY_EPSILON;
		case 'right':
			return box.x0 >= s.x1 - ONE_WAY_EPSILON;
		default:
			return true;
	}
};

/**
 * Move a body for `dt` against a level's solids (`motion.js` `stepSolid`: x, then y, sliding along
 * a wall): the solids near its path, a one-way solid only while the body is wholly on the side it
 * blocks from, so a body coming from there is stopped and one from anywhere else passes. With a
 * `slide` (`{ corner }`, `arcade.online.slide`) it is `stepSlide`: the body is also carried round a
 * solid that ends within `corner` of it, and the solids that near are looked at.
 */
export function moveAgainstSolids(body, dt, solids, field, slide) {
	const box = aabbOf(body);
	const dx = (body.vx || 0) * dt;
	const dy = (body.vy || 0) * dt;
	const reach = slide?.corner > 0 ? slide.corner : 0;
	const swept = {
		x0: Math.min(box.x0, box.x0 + dx) - reach,
		y0: Math.min(box.y0, box.y0 + dy) - reach,
		x1: Math.max(box.x1, box.x1 + dx) + reach,
		y1: Math.max(box.y1, box.y1 + dy) + reach,
	};
	const near = [];
	for (const solid of queryStatic(solids, swept)) {
		if (onBlockedSide(box, solid)) near.push(solid.body);
	}
	if (!near.length) return stepBody(body, dt, field);
	stepSlide(body, dt, near, field, slide);
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
 * `arcade.online.rules.zones` entry gives a force, and its solids, the zones an entry makes `solid`
 * (`true`: from every side; `'below'` / `'above'` / `'left'` / `'right'`: only a body coming from
 * that side, a one-way solid such as a waterfall; P11.3). Each applies to the characters its rule
 * names (every one when it names none), held to the field and indexed once. `slide` is the game's
 * `arcade.online.slide`, carried on the level so every step of a player takes it. The server and a
 * predicting device build it from the same config, so both move the player alike.
 */
export function onlineLevel(zones, rules, character, field, slide) {
	const byId = new Map((zones ?? []).map((zone) => [zone.id, zone]));
	const cell = levelCell(field);
	const solids = [];
	for (const rule of rules ?? []) {
		const zone = byId.get(rule.zone);
		if (!zone || !rule.solid) continue;
		if (rule.characters && !rule.characters.includes(character)) continue;
		const clipped = clipToField(zone, field);
		if (!clipped) continue;
		const { id, x, y, w, h } = clipped;
		solids.push({
			id,
			x,
			y,
			w,
			h,
			from: rule.solid === true ? 'any' : rule.solid,
			box: { x0: x, y0: y, x1: x + w, y1: y + h },
			body: { id, shape: 'box', x: x + w / 2, y: y + h / 2, w, h, solid: true },
		});
	}
	return {
		currents: zoneForces(zones, rules, {
			character,
			clip: (zone) => clipToField(zone, field),
			cell,
		}),
		solids: createStaticIndex(solids, cell),
		...(slide?.corner > 0 ? { slide: { corner: slide.corner } } : {}),
	};
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
 * What a launch joins a room as, and whether its person has to choose first (`apps/lines`
 * `game/online.ts`). `carried` is the join the last page left for this one (a win screen's or a
 * menu's own leave for a new room), `launch` the launch's own `?rooms_name=` and
 * `?rooms_character=`; the carried one wins. `choose`: the game has a start menu and nothing names
 * a character, so the device shows the menu and joins with its answer. Until then it has joined no
 * room: nothing there can catch it, score off it or aim at it, whatever the room's phase. A game
 * with no start menu joins at once, and the room picks its character.
 */
export function launchJoin(carried, launch, hasMenu) {
	const name = carried.name ?? launch.name ?? undefined;
	const character = carried.character ?? launch.character ?? undefined;
	return {
		join: { name, character, ...(carried.pass ? { pass: carried.pass } : {}) },
		choose: hasMenu && !character,
	};
}

/**
 * WHAT A PERSON ASKS TO PLAY AS, on its device (`apps/lines` `game/online.ts`; the room's half is
 * `services/game-server` `roomSim.ts`): a caught person's Respawn, or a pick of another character
 * in the lobby, sent as an input's `respawn` and answered by the room's state alone.
 *
 * `press(respawn)` is a press of a character. `input(seq)` is the `respawn` input `seq` carries:
 * the ask, on every input from the press until the room acknowledges one that carried it.
 * `answer(ack, playing)` reads a state of the room, while the room takes the ask: `ack` the newest
 * input it applied for the own player and `playing` the character it has the player as, counted
 * as `respawn` is (0: none, it is out). The room answers on the very input that asks, so the state
 * whose `ack` reaches the first input that carried the ask says its answer too: the character
 * asked for, or anything else, when no place was left (`refused`, kept until the next press and no
 * longer sent). `drop()` forgets it (the room no longer takes it: round 1 started, the person is
 * back).
 *
 * The room answers a run of inputs asking the same once, and tests the place once
 * (`roomSim.ts`). So a press right after inputs that asked for the same character first sends
 * one input that asks for nothing: the room hears every press as an ask of its own.
 *
 * So every press is answered once, whatever events the room sends and in whatever order, and
 * nothing is asked for longer than the room takes to acknowledge an input.
 */
export function createRespawnAsk() {
	/** `{ respawn, from, refused }`: `from` is the first input that carried it (0: none yet). */
	let ask;
	/** What the last input carried. */
	let last = 0;
	return {
		press(respawn) {
			ask = { respawn, from: 0, refused: false };
		},
		input(seq) {
			const asking = ask && !ask.refused ? ask.respawn : 0;
			const respawn = asking && !ask.from && asking === last ? 0 : asking;
			if (respawn) ask.from ||= seq;
			last = respawn;
			return respawn;
		},
		answer(ack, playing) {
			if (!ask || !(ask.from > 0 && ack >= ask.from)) return;
			if (playing === ask.respawn) ask = undefined;
			else ask.refused = true;
		},
		drop() {
			ask = undefined;
		},
		get refused() {
			return ask?.refused === true;
		},
		/** What it holds, or `null` (the probe's). */
		held: () => (ask ? { ...ask } : null),
	};
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

/** How far behind the room everyone else is drawn, ms, in a room sending 20 states a second or
 *  more (`netcode.js` `createSnapshotClock`). */
export const INTERPOLATION_DELAY_MS = 100;

/** The delay for a room sending `patchHz` states a second: two of its states' time, so the render
 *  step always has a state on either side through one late or lost one, and never less than
 *  {@link INTERPOLATION_DELAY_MS}: 20 a second and faster draw as before, 15 a second (Salmons)
 *  133 ms, 10 a second 200 ms. The room widens its lag compensation by the same
 *  (`onlineRules.js` `rewindMsFor`). */
export const interpolationDelayFor = (patchHz) =>
	Math.max(INTERPOLATION_DELAY_MS, patchHz > 0 ? 2000 / patchHz : INTERPOLATION_DELAY_MS);

/**
 * PACKED PLACES (`docs/design/realtime-multiplayer.md` §5; owner, 2026-11-27). A device that joins
 * with `positions: PACKED_POSITIONS` is sent everyone else's place as two uint16 (`px`, `py`) in
 * steps of `1 / scale` px, where `scale` is the room's {@link positionScale}; its own player keeps
 * the float32 `x`, `y` its prediction is compared with. A device that does not ask, or a room that
 * cannot pack (its field is wider than 65535 px), is sent float32 for everyone as before.
 */
export const PACKED_POSITIONS = 'u16';

/** The finest a packed place gets: 1/16 px. */
const MOST_SCALE = 16;

/** Steps per px a uint16 place is packed in on `field`: the finest power of two (at most
 *  {@link MOST_SCALE}) that covers its longer side; 0 when not even whole px do. */
export function positionScale(field) {
	const side = Math.max(field.w, field.h, 1);
	let scale = MOST_SCALE;
	while (scale >= 1 && side * scale > UINT16_MAX) scale /= 2;
	return scale >= 1 ? scale : 0;
}

/** A place on the field (px) packed in `scale` steps a px: rounded, held to the uint16's range. */
export const packPosition = (px, scale) =>
	Math.min(UINT16_MAX, Math.max(0, Math.round(px * scale)));

/** A packed place back in px. */
export const unpackPosition = (packed, scale) => packed / scale;

/** Where the room says a player is, from its state as the device decoded it: the packed place when
 *  the room packs (`posScale` > 0) and sent this player's packed (`px` set), else `x` / `y` — a
 *  device's own player, a device that did not ask, or a server older than packed places. */
export function placeOnWire(player, posScale) {
	if (posScale > 0 && player.px !== undefined && player.py !== undefined)
		return { x: unpackPosition(player.px, posScale), y: unpackPosition(player.py, posScale) };
	return { x: player.x, y: player.y };
}
