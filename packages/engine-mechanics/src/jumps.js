/**
 * Arcade jumps (`docs/design/game-families.md` §4.4, P10.13): the `gravity` jump of a side view,
 * the `hop` of a top-down one, and the `flap` kick.
 *
 * A jump is authored by its HEIGHT (px) and its TIME to the apex (s), never by raw velocities: the
 * launch speed is `2·height / time` and the pull while it rises `2·height / time²`, so the body
 * tops out exactly `height` above where it left, `time` after. What makes it feel right:
 *
 * - **hold to jump higher**: with `minHeight`, letting go while still rising cuts the climb to the
 *   speed that rises `minHeight` more, so a tap gives `minHeight` and a held press `height`;
 * - **coyote time**: a press up to `coyoteMs` after walking off a ledge still jumps;
 * - **jump buffer**: a press up to `bufferMs` before landing jumps on landing;
 * - **air control**: `airControl` 0..1 scales how much the player steers while airborne.
 *
 * `hop` leaves the ground on a height `z` above the ground plane (drawn as a lift and a shadow);
 * the body's x / y keep moving on the plane. `flap` kicks a falling body up by `kick` px/s on each
 * press. Plain ESM for the reason `motion.js` is; every function is arithmetic over a state object
 * the loop keeps per character, so a replay is exact. Pinned by `scripts/check-arcade-platformer.mjs`.
 */

/** A press this long after leaving the ground still jumps, ms, when a jump names none. */
export const DEFAULT_COYOTE_MS = 100;

/** A press this long before landing jumps on landing, ms, when a jump names none. */
export const DEFAULT_BUFFER_MS = 100;

/** The jump kinds: a side-view `gravity` jump and a top-down `hop`. */
export const JUMP_KINDS = ['gravity', 'hop'];

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

const msOr = (v, fallback) => (finite(v) && v >= 0 ? v : fallback);

/** A jump's launch speed and pull (px/s, px/s²) from its height and time to the apex. */
export function jumpProfile(jump) {
	const height = finite(jump?.height) && jump.height > 0 ? jump.height : 0;
	const time = finite(jump?.time) && jump.time > 0 ? jump.time : 0;
	if (!height || !time) return { launch: 0, gravity: 0, cut: 0 };
	const gravity = (2 * height) / (time * time);
	const min = finite(jump.minHeight) && jump.minHeight > 0 ? Math.min(jump.minHeight, height) : 0;
	return { launch: (2 * height) / time, gravity, cut: min ? Math.sqrt(2 * gravity * min) : 0 };
}

/** A character's jump state: what the press was last step, the coyote and buffer clocks, the climb. */
export function createJumpState() {
	return { held: false, coyote: 0, buffer: 0, rising: false, z: 0, vz: 0 };
}

/** Advance the press: its edge opens the buffer, else the buffer counts down. A press counts while
 *  the move that lands comes within `bufferMs` of it; that landing is seen one step later, hence
 *  the one step of slack. Returns the edge. */
function press(jump, state, pressed, dtMs) {
	const edge = pressed && !state.held;
	state.held = pressed;
	if (edge) state.buffer = msOr(jump.bufferMs, DEFAULT_BUFFER_MS) + dtMs;
	else state.buffer = Math.max(0, state.buffer - dtMs);
	return edge;
}

/**
 * One step of a `gravity` jump, before the body moves. `grounded` is what the last move said.
 * Launches (sets `body.vy`) on a buffered press while grounded or within coyote time, cuts the
 * climb on an early release, and returns the pull to fall by this step: the jump's own while it
 * rises, `fallGravity` (absent ⇒ the jump's) otherwise. Returns `{ gravity, jumped }`.
 */
export function stepJump(jump, state, body, { pressed, grounded, dt, fallGravity }) {
	const profile = jumpProfile(jump);
	const dtMs = dt * 1000;
	press(jump, state, pressed, dtMs);
	if (grounded) {
		state.coyote = msOr(jump.coyoteMs, DEFAULT_COYOTE_MS);
		if (!((body.vy || 0) < 0)) state.rising = false;
	} else state.coyote = Math.max(0, state.coyote - dtMs);
	let jumped = false;
	if (state.buffer > 0 && (grounded || state.coyote > 0) && profile.launch > 0) {
		body.vy = -profile.launch;
		state.rising = true;
		state.buffer = 0;
		state.coyote = 0;
		jumped = true;
	}
	if (state.rising && !jumped) {
		if ((body.vy || 0) >= 0) state.rising = false;
		else if (!pressed && profile.cut > 0 && -body.vy > profile.cut) body.vy = -profile.cut;
	}
	const fallPull = finite(fallGravity) && fallGravity > 0 ? fallGravity : profile.gravity;
	return { gravity: state.rising ? profile.gravity : fallPull, jumped };
}

/**
 * One step of a `hop`: the height `z` above the ground plane, rising on a buffered press while on
 * the ground and falling back under the jump's pull, cut on an early release as a `gravity` jump
 * is. Lands at `z` 0. Returns `{ airborne, jumped, landed }`.
 */
export function stepHop(jump, state, { pressed, dt }) {
	const profile = jumpProfile(jump);
	press(jump, state, pressed, dt * 1000);
	let jumped = false;
	if (state.z <= 0 && state.buffer > 0 && profile.launch > 0) {
		state.vz = profile.launch;
		state.rising = true;
		state.buffer = 0;
		jumped = true;
	} else if (state.rising && !pressed && profile.cut > 0 && state.vz > profile.cut) {
		state.vz = profile.cut;
	}
	const wasUp = state.z > 0 || jumped;
	if (wasUp) {
		const g = profile.gravity;
		state.z += state.vz * dt - 0.5 * g * dt * dt;
		state.vz -= g * dt;
		if (state.vz <= 0) state.rising = false;
	}
	let landed = false;
	if (wasUp && state.z <= 0) {
		state.z = 0;
		state.vz = 0;
		state.rising = false;
		landed = !jumped;
	}
	return { airborne: state.z > 0, jumped, landed };
}

/** One step of a `flap`: a press kicks the body up to `kick` px/s. Returns whether it flapped. */
export function stepFlap(flap, state, body, pressed) {
	const edge = pressed && !state.held;
	state.held = pressed;
	if (!edge || !(finite(flap.kick) && flap.kick > 0)) return false;
	body.vy = -flap.kick;
	return true;
}
