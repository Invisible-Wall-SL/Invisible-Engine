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
 * Outside the fold: any other rules move (a knockback, a timed respawn), and a player whose body
 * fell `roomSim.ts` `CREDIT_SECONDS` behind the room's clock or that dropped, whom the room steps
 * by a resting input (its own yaw) without advancing its `ack`, so it does not hang in the air for
 * everyone else. The room sends each device its own player's whole body exactly
 * ({@link bodyOfWire3d}), so the device takes any of these in one correction, to the bit.
 *
 * {@link moveFromStick}, {@link yawFromRadians} and the bots use trigonometry: they run before the
 * step (the device's camera) or only on the server (bots), never in the predicted path.
 */

import { brainVelocity, createBrain, createBrainWorld, stepBrain } from './behaviours.js';
import { createRng } from './board.js';
import {
	BUTTON_JUMP,
	BUTTON_SPRINT,
	HASH3D_SEED,
	MAX_COLLIDERS_3D,
	MAX_COORD_3D,
	MAX_STEP_DT_3D,
	MAX_SUB_STEPS_3D,
	MAX_SWEEP_CELLS_3D,
	MAX_TRAMPOLINE_M,
	MAX_ZONES_3D,
	MOTION3D_DEFAULTS,
	MOTION3D_LIMITS,
	MOTION3D_HZ,
	MOTION3D_VERSION,
	MOVE_SCALE,
	RAMP_FACINGS,
	YAW_UNITS,
	collidersNear,
	createBody3d,
	createLevel3d,
	stepBody3d,
	sweepFits3d,
	topUnder,
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

/** `Player3D.flags`: the body's own booleans, which the room sends its own device. */
export const BODY3D_FLAGS = Object.freeze({ grounded: 1, held: 2, doubleUsed: 4 });

/** {@link BODY3D_FLAGS} of a body. */
export const bodyFlags3d = (body) =>
	(body.grounded ? BODY3D_FLAGS.grounded : 0) |
	(body.held ? BODY3D_FLAGS.held : 0) |
	(body.doubleUsed ? BODY3D_FLAGS.doubleUsed : 0);

/**
 * The whole body a room player's own device is sent (`services/game-server` `Player3D`'s own-only
 * fields: `bx by bz`, `vx vy vz` and `climb` as float64, `yaw`, `coyote`, `buffer`, `flags`) — the room's
 * body to the bit, which {@link createPredictor3d} takes as `Truth3d.body`.
 */
export const bodyOfWire3d = (p) => ({
	x: p.bx,
	y: p.by,
	z: p.bz,
	vx: p.vx,
	vy: p.vy,
	vz: p.vz,
	yaw: p.yaw,
	coyote: p.coyote,
	buffer: p.buffer,
	climb: p.climb,
	grounded: (p.flags & BODY3D_FLAGS.grounded) !== 0,
	held: (p.flags & BODY3D_FLAGS.held) !== 0,
	doubleUsed: (p.flags & BODY3D_FLAGS.doubleUsed) !== 0,
});

const BODY_NUMBERS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'coyote', 'buffer', 'climb'];

/**
 * Predict one player from its inputs and reconcile it with the room — `netcode.js`
 * `createPredictor` for a body with momentum. The room tells its own device the player's WHOLE
 * body exactly (`truth.body`, {@link bodyOfWire3d}): every recorded prediction is the whole body
 * too, so a state equal to the prediction at its `ack` in every field is a `match`, and anything
 * else — resting steps the room took because the device fell behind (`roomSim3d.ts`), a rules move,
 * an input the transport lost — is taken as the room has it and the inputs in flight are replayed
 * from there: one correction, after which the prediction is the room's to the bit again. A
 * correction that moves the drawn player more than `snapM` (a teleport) is drawn at once, not
 * faded. `body` is the player's `motion3d` body after the input `ack`; `level`, `spec` and `dt` are
 * the room's; `home` is where a fall puts it back ({@link respawnOnFall3d}) — by default where
 * `body` is, so make the predictor from the player's first state (ack 0), which shows its home.
 * A room whose rules kill a fall instead (Crash) is predicted with `fallRespawns: false`.
 *
 * A KNOCKBACK is the room's push on the player's velocity right after it applied input `seq` (a
 * `knockback` event): {@link Predictor3d.impulse} writes it into the prediction at that input and
 * replays the inputs since, so the room's next states match instead of correcting. A push at or
 * before the input the room's last state showed is already in that exact body: it is only noted.
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
	const numbers = new Float64Array(HISTORY * BODY_NUMBERS.length);
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
		const at = slot * BODY_NUMBERS.length;
		seqs[slot] = seq;
		BODY_NUMBERS.forEach((key, i) => {
			numbers[at + i] = body[key];
		});
		flags[slot] = bodyFlags3d(body);
	};
	/** Put `body` back as it was recorded at `slot`. */
	const recall = (slot) => {
		const at = slot * BODY_NUMBERS.length;
		BODY_NUMBERS.forEach((key, i) => {
			body[key] = numbers[at + i];
		});
		body.grounded = (flags[slot] & BODY3D_FLAGS.grounded) !== 0;
		body.held = (flags[slot] & BODY3D_FLAGS.held) !== 0;
		body.doubleUsed = (flags[slot] & BODY3D_FLAGS.doubleUsed) !== 0;
	};
	/** Whether the prediction recorded at `slot` is `truth` in every field, bit for bit. */
	const same = (slot, truth) => {
		const at = slot * BODY_NUMBERS.length;
		return (
			BODY_NUMBERS.every((key, i) => Object.is(numbers[at + i], truth[key])) &&
			flags[slot] === bodyFlags3d(truth)
		);
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
		/**
		 * Step a clamped input the moment it is sent; returns the step's result (none while held).
		 * `extra`: a second input in the same step of the device's clock (`createClockSync3d`), drawn
		 * from where the first one started rather than skipping its motion.
		 */
		input(input, extra = false) {
			if (!extra) {
				prev.x = body.x;
				prev.y = body.y;
				prev.z = body.z;
			}
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
		 * `knockback` event). The prediction from that input on is redone with the push; one the room's
		 * last state already covers (`seq` at or before its `ack`: the whole body is exact) or one
		 * older than the history is left as it is.
		 */
		impulse(seq, kick) {
			const known = impulses.has(seq);
			impulses.set(seq, kick);
			if (known || seq > lastSeq || seq <= acked) return;
			const slot = seq % HISTORY;
			if (seqs[slot] !== seq || still) return;
			for (const old of impulses.keys()) if (old < acked - HISTORY) impulses.delete(old);
			const from = { x: body.x, y: body.y, z: body.z };
			recall(slot);
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
		 * The room's word on this player: `{ ack, step?, still?, body }`, `body` its whole body now
		 * (after input `ack` and any steps the room took without one). An older state than one
		 * already taken returns `stale`; else `match` or `corrected`.
		 */
		reconcile(truth) {
			if (truth.ack < acked || (truth.step !== undefined && truth.step <= lastStep)) return 'stale';
			acked = truth.ack;
			if (truth.step !== undefined) lastStep = truth.step;
			while (pending.length && pending[0].seq <= truth.ack) pending.shift();
			const changed = Boolean(truth.still) !== still;
			still = Boolean(truth.still);
			const slot = truth.ack % HISTORY;
			if (!changed && seqs[slot] === truth.ack && same(slot, truth.body)) return 'match';
			const from = { x: body.x, y: body.y, z: body.z };
			for (const key of BODY_NUMBERS) body[key] = truth.body[key];
			body.grounded = truth.body.grounded;
			body.held = truth.body.held;
			body.doubleUsed = truth.body.doubleUsed;
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

/**
 * The most of its clock a device steps in one frame, s: `roomSim.ts` `CREDIT_SECONDS`, what the
 * room waits for a late body before resting it. A longer frame (a hitch) still sends every step
 * the room is waiting for; a longer gap (a hidden tab) the room has rested through.
 */
export const CATCH_UP_SECONDS_3D = 0.5;

/** States a {@link createClockSync3d} judges the device's clock over, at the least. */
const SYNC_STATES = 8;

/**
 * Keep a device's input clock on the room's. A device sends one input per step of its own fixed
 * clock, and two clocks drift: one even a little fast fills the room's input buffer for good (each
 * input then waits longer, until the buffer overflows and drops one), one slow leaves the body
 * owing steps until the room rests it (`roomSim3d.ts`). The room tells its own device, with each
 * state, the inputs it holds for it (`waiting`) and the steps its body owes (`credit`); the device's
 * lead is `waiting − credit` (a device on the room's clock leads by 0 or 1). Judged over `states`
 * states at a time (about a second): a lead that never fell under 2 skips enough inputs to bring it
 * back to 1, and one that never rose over −2 adds enough to bring it back to −1 (sent one extra a
 * step: the catch-up the room's credit is for). After a nudge the next
 * span is not judged, so the room's answer to it arrives first. `observe` returns the nudge: the
 * inputs to skip (negative) or to add now (positive), else 0. Observe only states that arrived while
 * the device was stepping, and `reset` after a gap (a hidden tab): the room's view of a device that
 * sent nothing says nothing about its clock.
 */
export function createClockSync3d({ states = SYNC_STATES } = {}) {
	const span = Math.max(SYNC_STATES, Math.floor(states));
	let lo = Infinity;
	let hi = -Infinity;
	let seen = 0;
	return {
		reset() {
			lo = Infinity;
			hi = -Infinity;
			seen = 0;
		},
		observe(waiting, credit) {
			const lead = finite(waiting) - finite(credit);
			if (seen >= 0) {
				if (lead < lo) lo = lead;
				if (lead > hi) hi = lead;
			}
			if (++seen < span) return 0;
			const nudge = lo >= 2 ? 1 - lo : hi <= -2 ? -1 - hi : 0;
			lo = Infinity;
			hi = -Infinity;
			seen = nudge === 0 ? 0 : -span;
			return nudge;
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

/**
 * `spec`, if a step of it sweeps no more than `MAX_SWEEP_CELLS_3D` columns (`sweepFits3d`) and its
 * body cannot pass through a wall: a sub-step moves it at most `2 * radius` on the plane (further,
 * its box before and after a sub-step leaves a gap a thin wall fits in — the vertical move is
 * swept), and the slowest step at a sprint needs no more than `MAX_SUB_STEPS_3D` of them, past
 * which a sub-step would be longer than `subMove`.
 */
const sweptBy = (spec, path, cellSize) => {
	if (!sweepFits3d(spec, cellSize))
		throw new Error(
			`${path}: radius ${spec.radius} m at ${spec.speed * spec.sprint} m/s sweeps more than ` +
				`${MAX_SWEEP_CELLS_3D} cells of ${cellSize} m in a ${MAX_STEP_DT_3D} s step`,
		);
	if (spec.subMove > 2 * spec.radius)
		throw new Error(
			`${path}.subMove: at most twice the radius (${2 * spec.radius} m), or a body passes ` +
				`through a thin wall (${spec.subMove})`,
		);
	if (spec.speed * spec.sprint * MAX_STEP_DT_3D > MAX_SUB_STEPS_3D * spec.subMove)
		throw new Error(
			`${path}.subMove: ${spec.speed * spec.sprint} m/s takes more than ${MAX_SUB_STEPS_3D} ` +
				`sub-steps of ${spec.subMove} m in a ${MAX_STEP_DT_3D} s step`,
		);
	return spec;
};

/** Throw if a body of `spec` placed at `spawn` is below the death plane or inside a collider. */
const standsAt = (spawn, spec, level, path) => {
	if (!(spawn.y >= level.killY))
		throw new Error(`${path}.y: below the level's killY ${level.killY}`);
	const r = spec.radius;
	const [x0, z0, x1, z1] = [spawn.x - r, spawn.z - r, spawn.x + r, spawn.z + r];
	for (const c of collidersNear(level, x0, z0, x1, z1)) {
		if (!(x0 < c.maxX && x1 > c.minX && z0 < c.maxZ && z1 > c.minZ)) continue;
		if (spawn.y < topUnder(c, x0, z0, x1, z1) && spawn.y + spec.height > c.minY)
			throw new Error(`${path}: a body of radius ${r} m there is inside collider ${c.id}`);
	}
};

/**
 * The 3D world of a config's raw `arcade.world3d` block — `undefined` when there is none (a 2D
 * game), else `{ level, motion, characters, spawns }`, or a thrown `Error` naming the first bad
 * path. `level` is `createLevel3d`'s input (`{ colliders, zones, cellSize, killY }`), checked by
 * building it once; `motion` is `MOTION3D_DEFAULTS` with the block's overrides, and `characters`
 * each character's own on top (by `arcade.online.characters` id); `spawns` are `{ x, y, z, yaw,
 * team? }` places joining players and bots take in turn (default: the origin). `generator` names a
 * level made per room from its seed (`onlineGenerators3d.js` `generatedWorld3d`, which then
 * replaces `level` and `spawns`); it is kept as a name here, so this file imports no generator.
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
		const spawn = {
			x: place(s.x ?? 0, `${path}.x`),
			y: place(s.y ?? 0, `${path}.y`),
			z: place(s.z ?? 0, `${path}.z`),
			yaw: Math.floor(number(s.yaw ?? 0, `${path}.yaw`)) & 0xffff,
		};
		if (s.team !== undefined) {
			if (s.team !== 0 && s.team !== 1) throw new Error(`${path}.team: 0 (red) or 1 (blue)`);
			spawn.team = s.team;
		}
		Object.freeze(spawn);
		for (const spec of [motion, ...Object.values(characters)]) standsAt(spawn, spec, built, path);
		return spawn;
	});
	const bots = botsOf(raw.bots);
	const draft = {
		level,
		motion,
		characters: Object.freeze(characters),
		spawns,
		...(bots ? { bots } : {}),
	};
	if (raw.generator !== undefined) {
		if (typeof raw.generator !== 'string' || !raw.generator)
			throw new Error('arcade.world3d.generator: a generator id');
		draft.generator = raw.generator;
	}
	const world = Object.freeze(draft);
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

const WORLD_TEXTS = new WeakMap();

const canonical = (v) => {
	if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
	if (isObject(v))
		return `{${Object.keys(v)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(v[key])}`)
			.join(',')}}`;
	return JSON.stringify(v);
};

/**
 * A uint32 fingerprint (FNV-1a) of everything a device's prediction of a room rests on: the step's
 * code (`motion3d` `MOTION3D_VERSION`), the room's tick rate and a {@link world3dOf} world's level,
 * motion, characters and spawns (as canonical JSON). The room puts it in its state
 * (`RoomState3D.world`): a device that would step its player otherwise — a republish the game
 * server has not fetched yet, a runtime released before or after the game server, a stale bundle —
 * would mispredict on every step, so it compares and refuses instead.
 */
export function worldHash3d(world, tickHz) {
	let text = WORLD_TEXTS.get(world);
	if (text === undefined) {
		text = canonical(world);
		WORLD_TEXTS.set(world, text);
	}
	const all = `${MOTION3D_VERSION}|${tickHz}|${text}`;
	let h = HASH3D_SEED;
	for (let i = 0; i < all.length; i++) h = Math.imul(h ^ all.charCodeAt(i), 0x01000193) >>> 0;
	return h;
}

const NAV_KEYS = ['cell', 'maxDrop'];
const CRASH_NUMBERS = [
	'sight',
	'attackRange',
	'eye',
	'repathSteps',
	'wanderRadius',
	'pickupRange',
	'escortDistance',
];
const CRASH_WEIGHTS = ['fight', 'carry', 'escort', 'intercept', 'wander'];

const nonNegative = (v, path) => {
	const n = number(v, path);
	if (n < 0) throw new Error(`${path}: must not be negative`);
	return n;
};

/** A crash brain's numbers and weights (the whole block, or one hero's). */
const crashPartOf = (raw, path) => {
	if (!isObject(raw)) throw new Error(`${path}: not an object`);
	const out = {};
	for (const key of CRASH_NUMBERS)
		if (raw[key] !== undefined) out[key] = nonNegative(raw[key], `${path}.${key}`);
	if (raw.weights !== undefined) {
		if (!isObject(raw.weights)) throw new Error(`${path}.weights: not an object`);
		const weights = {};
		for (const key of CRASH_WEIGHTS)
			if (raw.weights[key] !== undefined)
				weights[key] = nonNegative(raw.weights[key], `${path}.weights.${key}`);
		out.weights = Object.freeze(weights);
	}
	return out;
};

/**
 * `arcade.world3d.bots`: `{ nav?: { cell?, maxDrop? }, crash?: { carry?, <numbers>, weights?,
 * heroes?: { <character id>: { <numbers>, weights? } } } }` — the nav graph's grid and the Crash
 * brain (`crashBots3d.js`); a world with no `crash` block keeps the plane brain.
 */
function botsOf(raw) {
	if (raw === undefined) return undefined;
	if (!isObject(raw)) throw new Error('arcade.world3d.bots: not an object');
	const out = {};
	if (raw.nav !== undefined) {
		if (!isObject(raw.nav)) throw new Error('arcade.world3d.bots.nav: not an object');
		const nav = {};
		for (const key of NAV_KEYS)
			if (raw.nav[key] !== undefined) {
				nav[key] = number(raw.nav[key], `arcade.world3d.bots.nav.${key}`);
				if (!(nav[key] > 0)) throw new Error(`arcade.world3d.bots.nav.${key}: must be positive`);
			}
		out.nav = Object.freeze(nav);
	}
	if (raw.crash !== undefined) {
		const path = 'arcade.world3d.bots.crash';
		const crash = crashPartOf(raw.crash, path);
		if (raw.crash.carry !== undefined) {
			if (typeof raw.crash.carry !== 'boolean') throw new Error(`${path}.carry: true or false`);
			crash.carry = raw.crash.carry;
		}
		if (raw.crash.heroes !== undefined) {
			if (!isObject(raw.crash.heroes)) throw new Error(`${path}.heroes: not an object`);
			const heroes = {};
			for (const [id, hero] of Object.entries(raw.crash.heroes))
				heroes[id] = Object.freeze(crashPartOf(hero, `${path}.heroes.${id}`));
			crash.heroes = Object.freeze(heroes);
		}
		out.crash = Object.freeze(crash);
	}
	return Object.freeze(out);
}

/** The motion a character of `world` moves by: its own, else the world's. */
export const motionFor3d = (world, characterId) => world.characters[characterId] ?? world.motion;
