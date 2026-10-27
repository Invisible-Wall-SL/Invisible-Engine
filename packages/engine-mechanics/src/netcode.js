/**
 * Online netcode (`docs/design/realtime-multiplayer.md` §6; P10.15): how a device draws a room it
 * does not own — its own player PREDICTED, everyone else INTERPOLATED.
 *
 * Plain, dependency-free ESM beside `online.js`, so `scripts/check-netcode.mjs` drives the very
 * code the runtime runs through simulated latency, jitter and loss, with no socket and no clock.
 *
 * THE OWN PLAYER ({@link createPredictor}). Every input the device sends is stepped at once with
 * `online.js` `stepPlayer`, the function the room steps it with, and kept until the room says it
 * applied it (`ack`). When the room's state arrives, the prediction recorded for `ack` is compared
 * with the room's place: equal (to {@link MATCH_PX}), the device keeps its own fold — which is
 * float64, where the wire is float32, so it never chases the wire's rounding; different (an input
 * the room never got, a hit the device could not know of), the device takes the room's place and
 * replays the inputs still in flight on top. The drawn body never jumps for that: the difference
 * becomes an offset that fades over `smoothMs`, unless it is longer than `snapPx` (a respawn), which
 * is a move the player should see.
 *
 * EVERYONE ELSE ({@link createSnapshotClock}, {@link createInterpolator}). Each state the room sends
 * is stamped with its step. The clock turns arrival times into a steady render step `delayMs`
 * behind the room, and each player is drawn between the two states around it. The clock never runs
 * past the newest state (no guessing ahead) and changes its speed by at most a quarter, so a late,
 * lost or bunched-up state slows or hurries everyone a little rather than making them jump.
 */

import { stepPlayer } from './online.js';

/** A prediction this close to the room's place, px, is the same place. */
export const MATCH_PX = 1 / 64;

/** How long a misprediction takes to fade from the drawn body, ms. */
export const SMOOTH_MS = 100;

/** A correction longer than this, px, is drawn at once (a respawn, a catch), not faded. */
export const SNAP_PX = 128;

/** The snap distance for a character of `speed` px/s in a room sending `patchHz` states a second:
 *  {@link SNAP_PX}, or three states' travel if that is longer, so a fast character's moves between
 *  states (a catch-up step moves twice as far) are never mistaken for a teleport. */
export const snapFor = (speed, patchHz) => Math.max(SNAP_PX, (speed / patchHz) * 3);

/** How far behind the room everyone else is drawn, ms. */
export const INTERPOLATION_DELAY_MS = 100;

/** The most the render clock speeds up to catch up with its delay (0.25 = 25 % faster)… */
export const MAX_RATE = 0.25;

/** …and slows down when it is ahead. */
export const MAX_SLOW = 0.1;

/** How many predictions are kept to compare with the room's, by `seq`. */
const HISTORY = 256;

/** Below this, px, a fading offset is gone. */
const SETTLED_PX = 1e-3;

/**
 * Predict one player from its inputs and reconcile it with the room.
 *
 * `body` is the player's body where the room last placed it (its shape and edges; it is moved in
 * place) after the input `ack`, `speed` its character's, `ctx` / `field` / `level` the room's
 * ({@link stepContext}, the field, {@link onlineLevel}).
 */
export function createPredictor({
	body,
	speed,
	ctx,
	field,
	level,
	ack = 0,
	smoothMs = SMOOTH_MS,
	snapPx = SNAP_PX,
}) {
	/** Inputs sent and not yet acknowledged, oldest first. */
	const pending = [];
	const historySeq = new Float64Array(HISTORY).fill(-1);
	const historyX = new Float64Array(HISTORY);
	const historyY = new Float64Array(HISTORY);
	const prev = { x: body.x, y: body.y };
	const offset = { x: 0, y: 0 };
	let acked = -1;
	let lastStep = -1;
	let still = false;
	let corrections = 0;
	let snaps = 0;

	const remember = (seq) => {
		const slot = seq % HISTORY;
		historySeq[slot] = seq;
		historyX[slot] = body.x;
		historyY[slot] = body.y;
	};
	const stepOne = (input) => stepPlayer(body, still ? undefined : input, speed, ctx, field, level);
	remember(ack);
	acked = ack;

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
		/** Step a clamped input the moment it is sent. */
		input(input) {
			prev.x = body.x;
			prev.y = body.y;
			stepOne(input);
			pending.push(input);
			if (pending.length > HISTORY) pending.shift();
			remember(input.seq);
		},
		/**
		 * The room's word on this player: its place, the newest input it applied, whether it holds the
		 * player still (a stun, a catch) and the room step it is stamped with, when known. An older
		 * state than one already taken returns `stale`; else `match` or `corrected`.
		 */
		reconcile(truth) {
			if (truth.ack < acked || (truth.step !== undefined && truth.step <= lastStep)) return 'stale';
			acked = truth.ack;
			if (truth.step !== undefined) lastStep = truth.step;
			while (pending.length && pending[0].seq <= truth.ack) pending.shift();
			const changed = Boolean(truth.still) !== still;
			still = Boolean(truth.still);
			const slot = truth.ack % HISTORY;
			if (
				!changed &&
				historySeq[slot] === truth.ack &&
				Math.abs(historyX[slot] - truth.x) <= MATCH_PX &&
				Math.abs(historyY[slot] - truth.y) <= MATCH_PX
			) {
				return 'match';
			}
			const fromX = body.x;
			const fromY = body.y;
			body.x = truth.x;
			body.y = truth.y;
			remember(truth.ack);
			for (const input of pending) {
				stepOne(input);
				remember(input.seq);
			}
			const dx = body.x - fromX;
			const dy = body.y - fromY;
			prev.x += dx;
			prev.y += dy;
			if (Math.hypot(offset.x - dx, offset.y - dy) > snapPx) {
				offset.x = 0;
				offset.y = 0;
				snaps += 1;
			} else {
				offset.x -= dx;
				offset.y -= dy;
			}
			corrections += 1;
			return 'corrected';
		},
		/** Fade the correction offset by a frame of `dtMs`. */
		frame(dtMs) {
			const keep = Math.exp((-4 * Math.max(0, dtMs)) / smoothMs);
			offset.x = Math.abs(offset.x * keep) < SETTLED_PX ? 0 : offset.x * keep;
			offset.y = Math.abs(offset.y * keep) < SETTLED_PX ? 0 : offset.y * keep;
		},
		/** Where to draw the player: `alpha` of the way from the last step to this one, plus the
		 *  correction still fading. */
		drawn(alpha = 1) {
			const a = Math.min(1, Math.max(0, alpha));
			return {
				x: prev.x + (body.x - prev.x) * a + offset.x,
				y: prev.y + (body.y - prev.y) * a + offset.y,
			};
		},
	};
}

/**
 * The render clock for everyone else: room steps stamped on each state, read back as a steady step
 * `delayMs` behind the room. `stepMs` is one room step.
 *
 * The clock learns how late states arrive as an average that follows each arrival slowly and takes a
 * late one (a lost packet resent, everything behind it held up) only as far as twice the usual
 * spread, so one stall does not push everyone back for good. When it is behind it speeds up by at
 * most `maxRate`; when ahead it slows by at most `maxSlow`.
 */
export function createSnapshotClock({
	stepMs,
	delayMs = INTERPOLATION_DELAY_MS,
	maxRate = MAX_RATE,
	maxSlow = MAX_SLOW,
}) {
	let offset;
	let spread = 0;
	let newest = -Infinity;
	let render;
	let lastNow;
	return {
		get newest() {
			return newest;
		},
		/** A state stamped `step` arrived at `nowMs`. */
		observe(step, nowMs) {
			const sample = nowMs - step * stepMs;
			if (offset === undefined) {
				offset = sample;
				spread = stepMs;
			} else {
				const taken = Math.min(sample, offset + 2 * spread);
				spread += (Math.abs(taken - offset) - spread) * 0.05;
				offset += (taken - offset) * 0.05;
			}
			if (step > newest) newest = step;
		},
		/** The step to draw everyone else at, at `nowMs`; `undefined` before the first state. */
		advance(nowMs) {
			if (offset === undefined) return undefined;
			const target = (nowMs - offset - delayMs) / stepMs;
			if (render === undefined || Math.abs(target - render) * stepMs > 1000) render = target;
			else {
				const steps = Math.max(0, nowMs - lastNow) / stepMs;
				const lead = ((target - render) * stepMs) / 250;
				render += steps * (1 + Math.min(maxRate, Math.max(-maxSlow, lead)));
			}
			lastNow = nowMs;
			if (render > newest) render = newest;
			return render;
		},
	};
}

/** Each player's recent states, drawn at a render step. A jump longer than `snapPx` between two
 *  states (a respawn) is taken whole when the render step reaches it, not slid across. */
export function createInterpolator({ snapPx = SNAP_PX, keep = 32 } = {}) {
	const tracks = new Map();
	return {
		/** Record a player's place in the state stamped `step` (older or repeated steps are ignored). */
		push(id, step, x, y) {
			let track = tracks.get(id);
			if (!track) tracks.set(id, (track = []));
			if (track.length && track[track.length - 1].step >= step) return;
			track.push({ step, x, y });
			if (track.length > keep) track.shift();
		},
		remove(id) {
			tracks.delete(id);
		},
		/** Forget every player but those in `ids` (the room's players now). */
		retain(ids) {
			for (const id of tracks.keys()) if (!ids.has(id)) tracks.delete(id);
		},
		/** Where a player is at render step `at`: between the states around it, else the nearest. */
		at(id, at) {
			const track = tracks.get(id);
			if (!track?.length) return undefined;
			const first = track[0];
			if (at <= first.step) return { x: first.x, y: first.y };
			for (let i = 1; i < track.length; i++) {
				const b = track[i];
				if (at > b.step) continue;
				const a = track[i - 1];
				if (Math.hypot(b.x - a.x, b.y - a.y) > snapPx) {
					const to = at >= b.step ? b : a;
					return { x: to.x, y: to.y };
				}
				const t = (at - a.step) / (b.step - a.step);
				return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
			}
			const last = track[track.length - 1];
			return { x: last.x, y: last.y };
		},
	};
}
