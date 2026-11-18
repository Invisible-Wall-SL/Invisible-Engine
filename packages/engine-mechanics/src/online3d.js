/**
 * Online 3D arcade rooms (`docs/design/3d-games.md` Phase 1, `docs/design/3d/gameplay-evaluation.md`
 * §2–§3): what a 3D player's input is, the one-player step it drives, how a device predicts its own
 * player and interpolates everyone else, a bot's input, and the `arcade.world3d` block a room is
 * built from.
 *
 * Plain, dependency-free ESM beside `online.js` / `netcode.js`, for their reason: the game server
 * (`services/game-server` `roomSim3d.ts`) steps every player with {@link stepPlayer3d}, and a device
 * predicting its own player steps it with the same function, so the two can only disagree if they
 * were given different inputs. Nothing here is re-exported from the package's `index.ts`: only the
 * 3D path imports `engine-mechanics/src/online3d.js`, so no 2D bundle changes.
 *
 * An input is `{ seq, moveX, moveZ, buttons, yaw, pitch, view }`. `moveX` / `moveZ` are int8
 * WORLD-space axes, whose length is at most {@link MOVE_SCALE}: the device turns its stick and
 * camera into a world direction ({@link moveFromStick}) before it quantises, so the step never
 * computes a sine. `yaw` is a uint16 ({@link YAW_UNITS} to the turn) that is only copied; `pitch` is
 * in the same units, held to ±{@link PITCH_LIMIT}; `view` is the room step the device was drawing
 * everyone else at.
 *
 * A 3D body has momentum and gravity, so unlike the 2D room a player is stepped by its inputs: a
 * step with no input for it (jitter, a short stall) leaves the body as it is, mid-air included, and
 * the room catches its inputs up afterwards. A player's body is therefore exactly the fold of
 * {@link stepPlayer3d} over the inputs the room applied, in `seq` order, whatever the latency —
 * what `scripts/check-room-sim-3d.mjs` pins. A fall below the death plane is part of the fold
 * ({@link respawnOnFall3d}: back home at rest on that very step), so the device predicts it too.
 * Outside the fold, and reconciled by the device: any other rules move (a knockback, a timed
 * respawn), and a player that stopped sending for `roomSim.ts` `CREDIT_SECONDS` or dropped, whom
 * the room steps by a resting input (its own yaw) without advancing its `ack`, so it does not hang
 * in the air for everyone else.
 *
 * {@link moveFromStick}, {@link yawFromRadians} and the bots use trigonometry: they run before the
 * step (the device's camera) or only on the server (bots), never in the predicted path.
 */

import { brainVelocity, createBrain, createBrainWorld, stepBrain } from './behaviours.js';
import { createRng } from './board.js';
import {
	BUTTON_JUMP,
	BUTTON_SPRINT,
	MAX_COLLIDERS_3D,
	MAX_COORD_3D,
	MAX_STEP_DT_3D,
	MAX_SWEEP_CELLS_3D,
	MAX_TRAMPOLINE_M,
	MAX_ZONES_3D,
	MOTION3D_DEFAULTS,
	MOTION3D_LIMITS,
	MOTION3D_HZ,
	MOVE_SCALE,
	RAMP_FACINGS,
	YAW_UNITS,
	createBody3d,
	createLevel3d,
	stepBody3d,
	sweepFits3d,
} from './motion3d.js';
import { SMOOTH_MS } from './netcode.js';

export { BOT_PREFIX, isBotId } from './onlineBots.js';
export { createSnapshotClock, INTERPOLATION_DELAY_MS } from './netcode.js';
export { MOVE_SCALE, YAW_UNITS };

/** The input's buttons; `jump` and `sprint` are `motion3d.js`'s, the rest are the rules'. */
export const BUTTONS3D = Object.freeze({
	jump: BUTTON_JUMP,
	sprint: BUTTON_SPRINT,
	attack: 4,
	altAttack: 8,
	interact: 16,
	ability: 32,
});

const BUTTON_MASK = 63;

/** A 3D player's `status`: free, or `dead` (Crash, `crashRules.js`), whom the room holds still. */
export const STATUS3D = Object.freeze({ free: 0, dead: 5 });

/** Pitch is held to a quarter turn up or down. */
export const PITCH_LIMIT = YAW_UNITS / 4;

/** `Player3D.anim`: what the view's animation reads, besides the velocity it interpolates. */
export const ANIM3D = Object.freeze({
	grounded: 1,
	sprinting: 2,
	carrying: 4,
	aiming: 8,
	doubleJumped: 16,
});

const UINT32_MAX = 0xffffffff;

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const towardZero = (v) => (v < 0 ? Math.ceil(v) : Math.floor(v));

const uint32 = (v) => {
	const n = Math.floor(finite(v));
	return n < 0 ? 0 : n > UINT32_MAX ? UINT32_MAX : n;
};

/** Whole move axes no longer than {@link MOVE_SCALE}: `online.js`'s clamp, exact and idempotent. */
function clampMove(x, z) {
	let mx = Math.max(-MOVE_SCALE, Math.min(MOVE_SCALE, Math.round(finite(x))));
	let mz = Math.max(-MOVE_SCALE, Math.min(MOVE_SCALE, Math.round(finite(z))));
	const limit = MOVE_SCALE * MOVE_SCALE;
	if (mx * mx + mz * mz > limit) {
		const scale = MOVE_SCALE / Math.sqrt(mx * mx + mz * mz);
		mx = towardZero(mx * scale);
		mz = towardZero(mz * scale);
		while (mx * mx + mz * mz > limit) {
			if (Math.abs(mx) >= Math.abs(mz)) mx -= Math.sign(mx);
			else mz -= Math.sign(mz);
		}
	}
	return [mx + 0, mz + 0];
}

/**
 * Clamp an input in place: `seq` / `view` to whole uint32s, the move to whole steps no longer than
 * {@link MOVE_SCALE}, `buttons` to {@link BUTTONS3D}, `yaw` wrapped onto a uint16, `pitch` held to
 * ±{@link PITCH_LIMIT}. Anything that is not a finite number reads as 0. Returns the input.
 */
export function sanitizeInput3d(input) {
	input.seq = uint32(input.seq);
	const [mx, mz] = clampMove(input.moveX, input.moveZ);
	input.moveX = mx;
	input.moveZ = mz;
	input.buttons = Math.floor(finite(input.buttons)) & BUTTON_MASK;
	input.yaw = Math.floor(finite(input.yaw)) & 0xffff;
	const pitch = Math.round(finite(input.pitch));
	input.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch)) + 0;
	input.view = uint32(input.view);
	return input;
}

/** A new, clamped input from anything (`{}` is a resting input at seq 0). */
export function clampInput3d(raw) {
	const src = raw && typeof raw === 'object' ? raw : {};
	return sanitizeInput3d({
		seq: src.seq,
		moveX: src.moveX,
		moveZ: src.moveZ,
		buttons: src.buttons,
		yaw: src.yaw,
		pitch: src.pitch,
		view: src.view,
	});
}

const MOTION_INPUT = { mx: 0, mz: 0, yaw: 0, buttons: 0 };

/**
 * One fixed step of one player by one clamped input: `motion3d.js` `stepBody3d` at the room's `dt`
 * (`online.js` `stepContext(tickHz).dt`; the step sub-steps itself, so `online.subSteps` is not
 * read). Returns the step's result.
 */
export function stepPlayer3d(body, input, level, spec = MOTION3D_DEFAULTS, dt = 1 / MOTION3D_HZ) {
	MOTION_INPUT.mx = input.moveX;
	MOTION_INPUT.mz = input.moveZ;
	MOTION_INPUT.yaw = input.yaw;
	MOTION_INPUT.buttons = input.buttons;
	return stepBody3d(body, MOTION_INPUT, level, spec, dt);
}

/**
 * The death plane's rule, which the room and a predicting device both run after every step: a body
 * the step left below the level's `killY` (`result.fell`) is put back at `home` (`{ x, y, z,
 * yaw }`) at rest. Returns whether it was.
 */
export function respawnOnFall3d(body, result, home) {
	if (!result.fell) return false;
	Object.assign(body, createBody3d(home));
	return true;
}

/** {@link ANIM3D} bits of a body after a step by `input`; `extra` adds the rules' (carrying). */
export function animBits3d(body, input, extra = 0) {
	let bits = extra & ~(ANIM3D.grounded | ANIM3D.sprinting | ANIM3D.aiming | ANIM3D.doubleJumped);
	if (body.grounded) bits |= ANIM3D.grounded;
	const moving = input && (input.moveX !== 0 || input.moveZ !== 0);
	if (moving && input.buttons & BUTTONS3D.sprint) bits |= ANIM3D.sprinting;
	if (input && input.buttons & BUTTONS3D.altAttack) bits |= ANIM3D.aiming;
	if (body.doubleUsed && !body.grounded) bits |= ANIM3D.doubleJumped;
	return bits;
}

const TURN = 2 * Math.PI;

/** A yaw in radians as the wire's uint16. Yaw 0 looks down −z (the three.js camera's forward) and
 *  grows anticlockwise seen from above, as `Object3D.rotation.y` does. */
export const yawFromRadians = (radians) => {
	const units = Math.round((finite(radians) / TURN) * YAW_UNITS) % YAW_UNITS;
	return units < 0 ? units + YAW_UNITS : units;
};

/** A uint16 yaw (or an interpolated one) in radians, for `Object3D.rotation.y`. */
export const radiansOfYaw = (yaw) => (yaw / YAW_UNITS) * TURN;

/** A pitch in radians (up positive) as the wire's int16, held to ±{@link PITCH_LIMIT}. */
export const pitchFromRadians = (radians) =>
	Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.round((finite(radians) / TURN) * YAW_UNITS))) +
	0;

/**
 * A stick (`x` right, `y` forward, each −1..1) seen by a camera at `yaw` (uint16) as the input's
 * int8 world axes: the trigonometry happens here, on the device, before quantising.
 */
export function moveFromStick(x, y, yaw) {
	const theta = radiansOfYaw(yaw);
	const s = Math.sin(theta);
	const c = Math.cos(theta);
	const wx = c * finite(x) - s * finite(y);
	const wz = -s * finite(x) - c * finite(y);
	const [moveX, moveZ] = clampMove(wx * MOVE_SCALE, wz * MOVE_SCALE);
	return { moveX, moveZ };
}

/** The yaw that faces along a plane direction (server-side: a bot's heading). */
const yawAlong = (vx, vz) => yawFromRadians(Math.atan2(-vx, -vz));

// --- the device: its own player predicted, everyone else interpolated -------------------------

/** A prediction this close to the room's place, m, on each axis, is the same place. */
export const MATCH_M = 1e-3;

/** A correction longer than this, m, is drawn at once (a respawn), not faded. */
export const SNAP_M = 3;

/** The snap distance for a body of `spec` in a room sending `patchHz` states a second: {@link SNAP_M},
 *  or three states' travel at a sprint if that is longer. */
export const snapFor3d = (spec, patchHz) =>
	Math.max(SNAP_M, ((spec.speed * spec.sprint) / patchHz) * 3);

/** Predictions kept to compare with the room's, by `seq`. */
const HISTORY = 256;

/** Below this, m, a fading offset is gone. */
const SETTLED_M = 1e-4;

/** The most steps one reconcile spends looking for the room's resting steps. */
const REST_SEARCH_STEPS = 2048;

/**
 * Predict one player from its inputs and reconcile it with the room — `netcode.js`
 * `createPredictor` for a body with momentum: every recorded prediction is the whole body (place,
 * velocity, jump clocks), so a correction replays the inputs in flight from the room's place with
 * the velocity the device had there. A correction longer than `snapM` (a teleport) is a new body
 * at rest. A player the room stepped at rest because it went silent (`roomSim3d.ts`) is found
 * exactly: from the last state taken, the predictor tries each count of resting steps the room's
 * step count allows, then the inputs the room applied since, and keeps the one that lands on the
 * room's place — so the device is back on the fold in that one correction. The search stops once
 * the resting body has settled on the ground (any longer rest is the same), so a long silence costs
 * no more than its fall, and spends at most {@link REST_SEARCH_STEPS} steps. It models resting
 * steps THEN inputs only: a state that shows inputs, rests and inputs again (patches lost across
 * two silences) is taken as an ordinary correction, which the next states settle. `body` is the
 * player's `motion3d` body after the input `ack`; `level`, `spec` and `dt` are the room's; `home` is
 * where a fall puts it back ({@link respawnOnFall3d}) — by default where `body` is, so make the
 * predictor from the player's first state (ack 0), which shows its home. A room whose rules kill a
 * fall instead (Crash) is predicted with `fallRespawns: false`.
 *
 * A KNOCKBACK is the room's push on the player's velocity right after it applied input `seq`
 * (a `knockback` event): {@link Predictor3d.impulse} writes it into the prediction at that input and
 * replays the inputs since, so the room's next states match instead of correcting.
 */
export function createPredictor3d({
	body,
	level,
	spec = MOTION3D_DEFAULTS,
	dt = 1 / MOTION3D_HZ,
	ack = 0,
	home = { x: body.x, y: body.y, z: body.z, yaw: body.yaw },
	smoothMs = SMOOTH_MS,
	snapM = SNAP_M,
	fallRespawns = true,
}) {
	const pending = [];
	/** Inputs sent, by `seq` slot, to replay from an impulse's input. */
	const sent = new Array(HISTORY);
	/** `seq` → a push the room gave after that input, kept until the room is past it. */
	const impulses = new Map();
	let lastSeq = ack;
	const seqs = new Float64Array(HISTORY).fill(-1);
	const numbers = new Float64Array(HISTORY * 8);
	const flags = new Uint8Array(HISTORY);
	const prev = { x: body.x, y: body.y, z: body.z };
	const offset = { x: 0, y: 0, z: 0 };
	let acked = ack;
	let lastStep = -1;
	let still = false;
	let corrections = 0;
	let snaps = 0;

	const remember = (seq) => {
		const slot = seq % HISTORY;
		const at = slot * 8;
		seqs[slot] = seq;
		numbers[at] = body.x;
		numbers[at + 1] = body.y;
		numbers[at + 2] = body.z;
		numbers[at + 3] = body.vx;
		numbers[at + 4] = body.vy;
		numbers[at + 5] = body.vz;
		numbers[at + 6] = body.coyote;
		numbers[at + 7] = body.buffer;
		flags[slot] = (body.grounded ? 1 : 0) | (body.held ? 2 : 0) | (body.doubleUsed ? 4 : 0);
	};
	const recall = (slot) => {
		const at = slot * 8;
		body.vx = numbers[at + 3];
		body.vy = numbers[at + 4];
		body.vz = numbers[at + 5];
		body.coyote = numbers[at + 6];
		body.buffer = numbers[at + 7];
		body.grounded = (flags[slot] & 1) !== 0;
		body.held = (flags[slot] & 2) !== 0;
		body.doubleUsed = (flags[slot] & 4) !== 0;
	};
	const atRest = () => {
		body.vx = 0;
		body.vy = 0;
		body.vz = 0;
		body.coyote = 0;
		body.buffer = 0;
		body.grounded = false;
		body.held = false;
		body.doubleUsed = false;
	};
	const push = (seq) => {
		const kick = impulses.get(seq);
		if (!kick) return;
		body.vx += kick.vx;
		body.vy = Math.max(body.vy, 0) + kick.vy;
		body.vz += kick.vz;
		body.grounded = false;
	};
	const stepOne = (input) => {
		if (still) return undefined;
		const result = stepPlayer3d(body, input, level, spec, dt);
		if (fallRespawns) respawnOnFall3d(body, result, home);
		push(input.seq);
		return result;
	};
	const resting = { seq: 0, moveX: 0, moveZ: 0, buttons: 0, yaw: 0, pitch: 0, view: 0 };
	const rested = {};
	const last = {};
	const same = (a, b) =>
		a.x === b.x &&
		a.y === b.y &&
		a.z === b.z &&
		a.vx === b.vx &&
		a.vy === b.vy &&
		a.vz === b.vz &&
		a.coyote === b.coyote &&
		a.buffer === b.buffer &&
		a.grounded === b.grounded &&
		a.held === b.held &&
		a.doubleUsed === b.doubleUsed;
	const near = (truth) =>
		Math.abs(body.x - truth.x) <= MATCH_M &&
		Math.abs(body.y - truth.y) <= MATCH_M &&
		Math.abs(body.z - truth.z) <= MATCH_M;
	/** Put `body` where the room has it if the room took the state at `from` through some resting
	 *  steps (at most `steps`) and then `applied`; false, and `body` untouched, if not. */
	const restFrom = (from, applied, steps, truth) => {
		const slot = from % HISTORY;
		if (seqs[slot] !== from || applied.length !== truth.ack - from) return false;
		const tries = Math.min(steps, Math.floor(REST_SEARCH_STEPS / (applied.length + 1)));
		const saved = { ...body };
		const at = slot * 8;
		recall(slot);
		body.x = numbers[at];
		body.y = numbers[at + 1];
		body.z = numbers[at + 2];
		resting.yaw = saved.yaw;
		for (let n = 1; n <= tries; n++) {
			Object.assign(last, body);
			stepOne(resting);
			const settled = body.grounded && same(last, body);
			Object.assign(rested, body);
			for (const input of applied) stepOne(input);
			if (near(truth)) return true;
			Object.assign(body, rested);
			if (settled) break;
		}
		Object.assign(body, saved);
		return false;
	};
	remember(ack);

	return {
		body,
		get pending() {
			return pending.length;
		},
		get corrections() {
			return corrections;
		},
		get snaps() {
			return snaps;
		},
		/** Step a clamped input the moment it is sent; returns the step's result (none while held). */
		input(input) {
			prev.x = body.x;
			prev.y = body.y;
			prev.z = body.z;
			const result = stepOne(input);
			pending.push(input);
			if (pending.length > HISTORY) pending.shift();
			sent[input.seq % HISTORY] = input;
			lastSeq = input.seq;
			remember(input.seq);
			return result;
		},
		/**
		 * The room pushed this player by `{ vx, vy, vz }` right after applying its input `seq` (a
		 * `knockback` event). The prediction from that input on is redone with the push; one older
		 * than the history is left to the next reconcile.
		 */
		impulse(seq, kick) {
			if (impulses.has(seq) || seq > lastSeq) {
				impulses.set(seq, kick);
				return;
			}
			impulses.set(seq, kick);
			const slot = seq % HISTORY;
			if (seqs[slot] !== seq || still) return;
			for (const old of impulses.keys()) if (old < acked - HISTORY) impulses.delete(old);
			const from = { x: body.x, y: body.y, z: body.z };
			const at = slot * 8;
			recall(slot);
			body.x = numbers[at];
			body.y = numbers[at + 1];
			body.z = numbers[at + 2];
			push(seq);
			remember(seq);
			for (let s = seq + 1; s <= lastSeq; s++) {
				const input = sent[s % HISTORY];
				if (!input || input.seq !== s) continue;
				stepOne(input);
				remember(s);
			}
			const dx = body.x - from.x;
			const dy = body.y - from.y;
			const dz = body.z - from.z;
			prev.x += dx;
			prev.y += dy;
			prev.z += dz;
			offset.x -= dx;
			offset.y -= dy;
			offset.z -= dz;
		},
		/**
		 * The room's word on this player: `{ x, y, z, ack, step?, still? }`. An older state than one
		 * already taken returns `stale`; else `match` or `corrected`.
		 */
		reconcile(truth) {
			if (truth.ack < acked || (truth.step !== undefined && truth.step <= lastStep)) return 'stale';
			const fromAck = acked;
			const steps = truth.step !== undefined && lastStep >= 0 ? truth.step - lastStep : 0;
			acked = truth.ack;
			if (truth.step !== undefined) lastStep = truth.step;
			const applied = [];
			while (pending.length && pending[0].seq <= truth.ack) {
				const input = pending.shift();
				if (input.seq > fromAck) applied.push(input);
			}
			const changed = Boolean(truth.still) !== still;
			still = Boolean(truth.still);
			const slot = truth.ack % HISTORY;
			const known = seqs[slot] === truth.ack;
			const at = slot * 8;
			if (
				!changed &&
				known &&
				Math.abs(numbers[at] - truth.x) <= MATCH_M &&
				Math.abs(numbers[at + 1] - truth.y) <= MATCH_M &&
				Math.abs(numbers[at + 2] - truth.z) <= MATCH_M
			) {
				return 'match';
			}
			const from = { x: body.x, y: body.y, z: body.z };
			if (changed || still || steps <= 0 || !restFrom(fromAck, applied, steps, truth)) {
				const moved = known
					? Math.max(
							Math.abs(numbers[at] - truth.x),
							Math.abs(numbers[at + 1] - truth.y),
							Math.abs(numbers[at + 2] - truth.z),
						)
					: Infinity;
				if (moved > snapM) atRest();
				else recall(slot);
				body.x = truth.x;
				body.y = truth.y;
				body.z = truth.z;
			}
			remember(truth.ack);
			for (const input of pending) {
				stepOne(input);
				remember(input.seq);
			}
			const dx = body.x - from.x;
			const dy = body.y - from.y;
			const dz = body.z - from.z;
			prev.x += dx;
			prev.y += dy;
			prev.z += dz;
			const ox = offset.x - dx;
			const oy = offset.y - dy;
			const oz = offset.z - dz;
			if (Math.sqrt(ox * ox + oy * oy + oz * oz) > snapM) {
				offset.x = 0;
				offset.y = 0;
				offset.z = 0;
				snaps += 1;
			} else {
				offset.x = ox;
				offset.y = oy;
				offset.z = oz;
			}
			corrections += 1;
			return 'corrected';
		},
		/** Fade the correction offset by a frame of `dtMs`. */
		frame(dtMs) {
			const keep = Math.exp((-4 * Math.max(0, dtMs)) / smoothMs);
			for (const axis of ['x', 'y', 'z']) {
				const v = offset[axis] * keep;
				offset[axis] = Math.abs(v) < SETTLED_M ? 0 : v;
			}
		},
		/** Where to draw the player: `alpha` of the way from the last step to this one, plus the
		 *  correction still fading; `yaw` is the newest input's. */
		drawn(alpha = 1) {
			const a = Math.min(1, Math.max(0, alpha));
			return {
				x: prev.x + (body.x - prev.x) * a + offset.x,
				y: prev.y + (body.y - prev.y) * a + offset.y,
				z: prev.z + (body.z - prev.z) * a + offset.z,
				yaw: body.yaw,
			};
		},
	};
}

/** The shorter way round from yaw `a` to yaw `b`, in yaw units (−32768..32767). */
const yawDelta = (a, b) => {
	const d = (((b - a) % YAW_UNITS) + YAW_UNITS) % YAW_UNITS;
	return d >= YAW_UNITS / 2 ? d - YAW_UNITS : d;
};

/**
 * Each player's recent states (`{ x, y, z, yaw, anim }`), drawn at a render step (`netcode.js`
 * `createSnapshotClock`): place lerped, yaw the shorter way round (a fraction of a unit, in
 * `[0, YAW_UNITS)`), `anim` the earlier state's until the later one is reached. A jump longer than
 * `snapM` between two states (a respawn) is taken whole, not slid across.
 */
export function createInterpolator3d({ snapM = SNAP_M, keep = 32 } = {}) {
	const tracks = new Map();
	const copy = (s) => ({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, anim: s.anim ?? 0 });
	return {
		/** Record a player's state stamped `step` (older or repeated steps are ignored). */
		push(id, step, state) {
			let track = tracks.get(id);
			if (!track) tracks.set(id, (track = []));
			if (track.length && track[track.length - 1].step >= step) return;
			track.push({ step, ...copy(state) });
			if (track.length > keep) track.shift();
		},
		/** Forget every player but those in `ids`. */
		retain(ids) {
			for (const id of tracks.keys()) if (!ids.has(id)) tracks.delete(id);
		},
		/** A player at render step `at`: between the states around it, else the nearest. */
		at(id, at) {
			const track = tracks.get(id);
			if (!track?.length) return undefined;
			if (at <= track[0].step) return copy(track[0]);
			for (let i = 1; i < track.length; i++) {
				const b = track[i];
				if (at > b.step) continue;
				const a = track[i - 1];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dz = b.z - a.z;
				if (Math.sqrt(dx * dx + dy * dy + dz * dz) > snapM) return copy(at >= b.step ? b : a);
				const t = (at - a.step) / (b.step - a.step);
				const yaw = a.yaw + yawDelta(a.yaw, b.yaw) * t;
				return {
					x: a.x + dx * t,
					y: a.y + dy * t,
					z: a.z + dz * t,
					yaw: yaw < 0 ? yaw + YAW_UNITS : yaw >= YAW_UNITS ? yaw - YAW_UNITS : yaw,
					anim: at >= b.step ? b.anim : a.anim,
				};
			}
			return copy(track[track.length - 1]);
		},
	};
}

// --- bots: a server-only brain on the plane ---------------------------------------------------

/**
 * A 3D bot's own state: an `behaviours.js` brain that sees the room on the x/z plane (`y` of its
 * world is the room's `z`), seeded with `seed`, and the `seq` its next input carries. `blocked` is
 * set by the room from the bot's last step (a wall stopped it): the bot jumps.
 */
export function createBot3d({ brain, seed, at }) {
	return {
		brain: createBrain(brain, { rng: createRng(seed), at: { x: at.x, y: at.z } }),
		seq: 0,
		blocked: false,
	};
}

/**
 * The bot's input for the next step. `self` and `players` are room players (`{ id, body, tags,
 * connected, status }`; a free player has status 0); the brain sees the connected free ones on the
 * plane, steps by `dt` and wants a velocity, which becomes a move at `spec.speed` (more is full
 * tilt) facing where it goes. Server-only: the device interpolates bots and never steps this.
 */
export function botInput3d(bot, self, players, { dt, spec = MOTION3D_DEFAULTS, view }) {
	const flat = (p) => ({ id: p.id, x: p.body.x, y: p.body.z, tags: p.tags ?? [] });
	const me = flat(self);
	const bodies = [me];
	for (const player of players) {
		if (player === self || !player.connected || player.status !== 0) continue;
		bodies.push(flat(player));
	}
	const world = createBrainWorld({ self: me, bodies, hitSolid: bot.blocked });
	stepBrain(bot.brain, world, dt);
	const velocity = brainVelocity(bot.brain, me, world, dt);
	const scale = spec.speed > 0 ? MOVE_SCALE / spec.speed : 0;
	const moving = velocity.vx !== 0 || velocity.vy !== 0;
	bot.seq += 1;
	return sanitizeInput3d({
		seq: bot.seq,
		moveX: velocity.vx * scale,
		moveZ: velocity.vy * scale,
		buttons: bot.blocked && moving ? BUTTONS3D.jump : 0,
		yaw: moving ? yawAlong(velocity.vx, velocity.vy) : self.body.yaw,
		pitch: 0,
		view,
	});
}

// --- the config: `arcade.world3d` -------------------------------------------------------------

const MOTION_KEYS = Object.keys(MOTION3D_DEFAULTS);
const BOX_KEYS = ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'];
const DEFAULT_CELL_SIZE = 4;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

const number = (v, path) => {
	if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${path}: not a number`);
	return v;
};

const place = (v, path) => {
	if (Math.abs(number(v, path)) > MAX_COORD_3D)
		throw new Error(`${path}: within ${MAX_COORD_3D} m of the origin`);
	return v;
};

const boxOf = (raw, path) => {
	if (!isObject(raw)) throw new Error(`${path}: not an object`);
	const box = {};
	for (const key of BOX_KEYS) box[key] = place(raw[key], `${path}.${key}`);
	return box;
};

const motionOf = (base, raw, path) => {
	if (raw === undefined) return base;
	if (!isObject(raw)) throw new Error(`${path}: not an object`);
	const spec = { ...base };
	for (const key of MOTION_KEYS)
		if (raw[key] !== undefined) spec[key] = number(raw[key], `${path}.${key}`);
	for (const key of MOTION_KEYS) {
		const [min, max] = MOTION3D_LIMITS[key];
		if (!(spec[key] >= min && spec[key] <= max))
			throw new Error(`${path}.${key}: from ${min} to ${max} (${spec[key]})`);
	}
	return Object.freeze(spec);
};

/** `spec`, if a step of it sweeps no more than `MAX_SWEEP_CELLS_3D` columns (`sweepFits3d`). */
const sweptBy = (spec, path, cellSize) => {
	if (!sweepFits3d(spec, cellSize))
		throw new Error(
			`${path}: radius ${spec.radius} m at ${spec.speed * spec.sprint} m/s sweeps more than ` +
				`${MAX_SWEEP_CELLS_3D} cells of ${cellSize} m in a ${MAX_STEP_DT_3D} s step`,
		);
	return spec;
};

/**
 * The 3D world of a config's raw `arcade.world3d` block — `undefined` when there is none (a 2D
 * game), else `{ level, motion, characters, spawns }`, or a thrown `Error` naming the first bad
 * path. `level` is `createLevel3d`'s input (`{ colliders, zones, cellSize, killY }`), checked by
 * building it once; `motion` is `MOTION3D_DEFAULTS` with the block's overrides, and `characters`
 * each character's own on top (by `arcade.online.characters` id); `spawns` are `{ x, y, z, yaw }`
 * places joining players and bots take in turn (default: the origin).
 *
 * `game-config` does not know this block (it is in every runtime; the 3D schema is not), so the
 * server and a 3D device read it from the raw doc.
 */
export function world3dOf(raw) {
	if (raw === undefined || raw === null) return undefined;
	if (!isObject(raw)) throw new Error('arcade.world3d: not an object');
	const levelRaw = raw.level ?? {};
	if (!isObject(levelRaw)) throw new Error('arcade.world3d.level: not an object');
	const collidersRaw = levelRaw.colliders ?? [];
	const zonesRaw = levelRaw.zones ?? [];
	if (!Array.isArray(collidersRaw) || collidersRaw.length > MAX_COLLIDERS_3D)
		throw new Error(`arcade.world3d.level.colliders: a list of at most ${MAX_COLLIDERS_3D}`);
	if (!Array.isArray(zonesRaw) || zonesRaw.length > MAX_ZONES_3D)
		throw new Error(`arcade.world3d.level.zones: a list of at most ${MAX_ZONES_3D}`);
	const cellSize =
		levelRaw.cellSize === undefined
			? DEFAULT_CELL_SIZE
			: number(levelRaw.cellSize, 'arcade.world3d.level.cellSize');
	const colliders = collidersRaw.map((c, i) => {
		const path = `arcade.world3d.level.colliders.${i}`;
		const box = boxOf(c, path);
		if (c.kind === 'ramp') {
			if (!RAMP_FACINGS.includes(c.facing)) throw new Error(`${path}.facing: ${RAMP_FACINGS}`);
			return { kind: 'ramp', facing: c.facing, ...box };
		}
		if (c.kind !== 'box') throw new Error(`${path}.kind: box or ramp`);
		return { kind: 'box', ...box };
	});
	const zones = zonesRaw.map((z, i) => {
		const path = `arcade.world3d.level.zones.${i}`;
		const box = boxOf(z, path);
		if (typeof z.kind !== 'string' || !z.kind) throw new Error(`${path}.kind: a name`);
		const zone = { kind: z.kind, ...box };
		if (z.height !== undefined) zone.height = number(z.height, `${path}.height`);
		if (zone.kind === 'trampoline' && !(zone.height > 0 && zone.height <= MAX_TRAMPOLINE_M))
			throw new Error(
				`${path}.height: a trampoline needs a height above 0, at most ${MAX_TRAMPOLINE_M}`,
			);
		return zone;
	});
	const level = { colliders, zones };
	if (levelRaw.cellSize !== undefined) level.cellSize = cellSize;
	if (levelRaw.killY !== undefined)
		level.killY = place(levelRaw.killY, 'arcade.world3d.level.killY');
	let built;
	try {
		built = createLevel3d(level);
	} catch (error) {
		throw new Error(`arcade.world3d.level: ${error instanceof Error ? error.message : error}`, {
			cause: error,
		});
	}
	const motion = sweptBy(
		motionOf(MOTION3D_DEFAULTS, raw.motion, 'arcade.world3d.motion'),
		'arcade.world3d.motion',
		cellSize,
	);
	const characters = {};
	if (raw.characters !== undefined) {
		if (!isObject(raw.characters)) throw new Error('arcade.world3d.characters: not an object');
		for (const [id, entry] of Object.entries(raw.characters)) {
			const path = `arcade.world3d.characters.${id}`;
			characters[id] = sweptBy(motionOf(motion, entry, path), path, cellSize);
		}
	}
	const spawnsRaw = raw.spawns ?? [{ x: 0, y: 0, z: 0 }];
	if (!Array.isArray(spawnsRaw) || !spawnsRaw.length)
		throw new Error('arcade.world3d.spawns: a list of places');
	const spawns = spawnsRaw.map((s, i) => {
		const path = `arcade.world3d.spawns.${i}`;
		if (!isObject(s)) throw new Error(`${path}: not an object`);
		// Held to float32, so the wire shows a home exactly and a device predicts a respawn to it.
		return Object.freeze({
			x: Math.fround(place(s.x ?? 0, `${path}.x`)),
			y: Math.fround(place(s.y ?? 0, `${path}.y`)),
			z: Math.fround(place(s.z ?? 0, `${path}.z`)),
			yaw: Math.floor(number(s.yaw ?? 0, `${path}.yaw`)) & 0xffff,
		});
	});
	const world = Object.freeze({ level, motion, characters: Object.freeze(characters), spawns });
	LEVELS.set(world, built);
	return world;
}

const LEVELS = new WeakMap();

/**
 * The one `createLevel3d` level of a {@link world3dOf} world: the build that checked it, so every
 * room of a game (`configSource.ts` keeps one world per doc) shares one level rather than building
 * its own. Its query scratch is safe to share: a step's queries are synchronous, each stamped anew.
 */
export function levelOf3d(world) {
	let level = LEVELS.get(world);
	if (!level) {
		level = createLevel3d(world.level);
		LEVELS.set(world, level);
	}
	return level;
}

/** The motion a character of `world` moves by: its own, else the world's. */
export const motionFor3d = (world, characterId) => world.characters[characterId] ?? world.motion;
