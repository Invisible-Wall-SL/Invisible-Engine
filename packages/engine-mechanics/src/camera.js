/**
 * The arcade camera (`docs/design/game-families.md` §4.4, P10.12): which part of a world bigger
 * than the screen a play field shows.
 *
 * Plain, dependency-free ESM for the reason `motion.js` is. The camera is a view rectangle in world
 * pixels: `x` / `y` is its TOP-LEFT, `view` its size (the screen's design size). Each fixed step it
 *   1. scrolls by `autoScroll` (px/s, per axis: a runner or a shooter);
 *   2. on every axis that does not scroll, aims at its goal — the followed body, kept inside a dead
 *      zone centred on the view and led by `lookAhead` seconds of its velocity — or at the point a
 *      `moveTo` named, eased by `smoothing` (a time constant, seconds; 0 snaps). A snap (the first
 *      sight of a target, or one asked for) centres the target at once;
 *   3. is held inside the world (`clampToWorld`, on by default; a world narrower than the view is
 *      centred);
 *   4. rattles by a decaying `shake`, drawn only: the view the despawn and the view signals test
 *      never shakes.
 *
 * A parallax layer of factor `p` (0 = fixed to the screen, 1 = moves with the world) is drawn
 * `(1 - p)` × the camera's offset away from where the world puts it ({@link parallaxOffset}).
 *
 * Determinism: the camera steps on the arcade loop's fixed step, with its own seeded random for the
 * shake, so a seed replays the same framing at any frame rate. Pinned by
 * `apps/launcher-api/scripts/check-arcade-camera.ts`.
 */

const finite = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const nonNegative = (v, fallback) => Math.max(0, finite(v, fallback));

/** A camera spec with every default applied. */
export function resolveCameraSpec(spec = {}) {
	return {
		follow: typeof spec.follow === 'string' && spec.follow.trim() ? spec.follow.trim() : undefined,
		deadZone: {
			w: nonNegative(spec.deadZone?.w, 0),
			h: nonNegative(spec.deadZone?.h, 0),
		},
		smoothing: nonNegative(spec.smoothing, 0),
		lookAhead: nonNegative(spec.lookAhead, 0),
		clampToWorld: spec.clampToWorld !== false,
		autoScroll: { x: finite(spec.autoScroll?.x, 0), y: finite(spec.autoScroll?.y, 0) },
	};
}

/**
 * A camera at the world's origin (held inside it). `spec` is a scene's `camera` block; `random` a
 * seeded `() => 0..1` for the shake.
 */
export function createCamera(spec, random) {
	const resolved = resolveCameraSpec(spec);
	return {
		spec: resolved,
		x: 0,
		y: 0,
		/** What it follows: a tag (the first body carrying it, in spawn order) or one body's id. */
		follow: resolved.follow ? { tag: resolved.follow } : undefined,
		/** A world point to centre on, from `moveTo`; cleared by a follow. */
		goal: undefined,
		autoScroll: { ...resolved.autoScroll },
		/** The next aim lands at once (a new round's first sight of its target, a `snap`). */
		snapNext: true,
		shake: { strength: 0, totalMs: 0, leftMs: 0 },
		offsetX: 0,
		offsetY: 0,
		random,
	};
}

const clampAxis = (pos, viewLen, worldLen) =>
	worldLen <= viewLen ? (worldLen - viewLen) / 2 : Math.min(Math.max(pos, 0), worldLen - viewLen);

/** Where the view's near edge must be for `focus` to sit inside a dead zone `dead` px wide. */
const aimAxis = (pos, viewLen, focus, dead) => {
	const centre = pos + viewLen / 2;
	const half = Math.min(dead, viewLen) / 2;
	if (focus > centre + half) return focus - half - viewLen / 2;
	if (focus < centre - half) return focus + half - viewLen / 2;
	return pos;
};

/**
 * One fixed step of `dt` seconds. `target` is the followed body this step (`{x, y, vx, vy}`, its
 * centre), or `undefined`; `view` the view's size; `world` the world's, when the screen has one.
 * Mutates and returns `camera`.
 */
export function stepCamera(camera, dt, { view, world, target }) {
	const { spec } = camera;
	camera.x += camera.autoScroll.x * dt;
	camera.y += camera.autoScroll.y * dt;
	let aimX;
	let aimY;
	if (target) {
		// A snap centres the target; after it, the dead zone holds the camera still.
		const dead = camera.snapNext ? { w: 0, h: 0 } : spec.deadZone;
		aimX = aimAxis(camera.x, view.w, target.x + target.vx * spec.lookAhead, dead.w);
		aimY = aimAxis(camera.y, view.h, target.y + target.vy * spec.lookAhead, dead.h);
	} else if (camera.goal) {
		aimX = camera.goal.x - view.w / 2;
		aimY = camera.goal.y - view.h / 2;
	}
	if (aimX !== undefined && aimY !== undefined) {
		const ease = camera.snapNext || spec.smoothing <= 0 ? 1 : 1 - Math.exp(-dt / spec.smoothing);
		if (!camera.autoScroll.x) camera.x += (aimX - camera.x) * ease;
		if (!camera.autoScroll.y) camera.y += (aimY - camera.y) * ease;
		camera.snapNext = false;
	}
	if (world && spec.clampToWorld) {
		camera.x = clampAxis(camera.x, view.w, world.w);
		camera.y = clampAxis(camera.y, view.h, world.h);
	}
	const { shake } = camera;
	if (shake.leftMs > 0) {
		const k = (shake.strength * shake.leftMs) / shake.totalMs;
		camera.offsetX = (camera.random() * 2 - 1) * k;
		camera.offsetY = (camera.random() * 2 - 1) * k;
		shake.leftMs = Math.max(0, shake.leftMs - dt * 1000);
	} else {
		camera.offsetX = 0;
		camera.offsetY = 0;
	}
	return camera;
}

/** Follow a tag or one body (`{tag}` / `{id}`), or nothing (`undefined`). `snap` lands at once. */
export function followWith(camera, follow, snap = false) {
	camera.follow = follow;
	if (follow) camera.goal = undefined;
	if (snap) camera.snapNext = true;
}

/** Centre the view on a world point (and stop following); `snap` lands at once. */
export function moveCameraTo(camera, x, y, snap = false) {
	camera.follow = undefined;
	camera.goal = { x, y };
	if (snap) camera.snapNext = true;
}

/** Rattle the drawn view by up to `strength` px, decaying to rest over `durationMs`. A stronger
 *  shake replaces a weaker one still running; a weaker one is ignored. */
export function shakeCamera(camera, strength, durationMs) {
	if (!(strength > 0 && durationMs > 0)) return;
	const { shake } = camera;
	const now = shake.leftMs > 0 ? (shake.strength * shake.leftMs) / shake.totalMs : 0;
	if (strength < now) return;
	shake.strength = strength;
	shake.totalMs = durationMs;
	shake.leftMs = durationMs;
}

/** The view rectangle in world px (no shake): `{ x0, y0, x1, y1 }`. */
export function viewRect(camera, view) {
	return { x0: camera.x, y0: camera.y, x1: camera.x + view.w, y1: camera.y + view.h };
}

/** Where a layer of parallax factor `{x, y}` is drawn, relative to where the world puts it. */
export function parallaxOffset(camera, factor) {
	return { x: camera.x * (1 - factor.x), y: camera.y * (1 - factor.y) };
}
