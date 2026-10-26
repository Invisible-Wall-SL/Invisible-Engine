/**
 * Arcade characters (`docs/design/game-families.md` §4.3, P10.11): the brain a character decides
 * with and the controllers a player drives one through.
 *
 * A brain is a small state machine: each state runs one behaviour preset (`chase`, `patrol`, …)
 * and each transition waits on world conditions (`targetWithin`, `timer`, …). A behaviour and a
 * controller only ever return a desired velocity; the loop steers the body towards it
 * (`motion.js` `steer`) and moves it (`stepSolid`). Plain ESM for the reason `motion.js` is, and
 * seeded: every random draw comes from the brain's own `rng`, so a replay is exact. Pinned by
 * `scripts/check-arcade-characters.mjs`.
 *
 * Units as in `motion.js`: px, px/s, `dt` in seconds; a brain's `time` and every authored duration
 * (`timer`, `every`, `period`, `turnEvery`) in ms.
 */

import { nearestDistance, pointAt, samplePath, touching } from './motion.js';

/** Each behaviour's parameters when a state leaves them out. */
export const BEHAVIOUR_DEFAULTS = {
	idle: {},
	wander: { speed: 80, turnEvery: 1500 },
	patrol: { speed: 100, dx: 200, dy: 0 },
	followPath: { speed: 100 },
	chase: { tag: 'player', range: 200, speed: 160 },
	flee: { tag: 'player', range: 200, speed: 160 },
	keepDistance: { tag: 'player', distance: 200, speed: 120 },
	hover: { amplitude: 12, period: 1200, axis: 'y' },
	shootAt: { tag: 'player', every: 2000, speed: 300, range: 600 },
};

export const BEHAVIOURS = Object.keys(BEHAVIOUR_DEFAULTS);

export const CONDITIONS = [
	'targetWithin',
	'targetBeyond',
	'touching',
	'hitSolid',
	'timer',
	'variable',
	'random',
];

/** The input-map actions the keyboard controllers read. */
export const CONTROLLER_ACTIONS = ['left', 'right', 'up', 'down'];

/** How often a `random` condition rolls when it names no `every`, ms. */
export const RANDOM_EVERY = 1000;

const ANY = '*';

/** Closer than this (px) to a path's end is there. */
const ARRIVED = 0.01;

/** How far ahead of a path-walking body its target stays, at least, px. */
export const PATH_LEAD = 12;

/** Slack on every clock comparison (ms): 30 steps of 1000/60 ms sum to 500 give or take an ulp,
 *  and a 500 ms timer must fire on the 30th. */
const CLOCK_EPSILON = 1e-6;

const numberParam = (params, key, fallback) => {
	const value = params[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const stringParam = (params, key, fallback) =>
	typeof params[key] === 'string' && params[key] !== '' ? params[key] : fallback;

/** A state's parameters over its behaviour's defaults (a wrongly typed value falls back). */
function paramsOf(state) {
	const defaults = BEHAVIOUR_DEFAULTS[state.behaviour] ?? {};
	const params = state.params ?? {};
	const out = {};
	for (const [key, fallback] of Object.entries(defaults)) {
		if (typeof fallback === 'number') out[key] = numberParam(params, key, fallback);
		else out[key] = stringParam(params, key, fallback);
	}
	for (const [key, value] of Object.entries(params)) if (!(key in out)) out[key] = value;
	return out;
}

const stateOf = (brain, id) => brain.spec.states.find((state) => state.id === id);

function enter(brain, id) {
	brain.state = id;
	brain.time = 0;
	brain.memory = {};
	brain.rolls = {};
}

/**
 * A brain for one character: `{ spec, state, time, memory, rolls, rng, at }`. `at` is where the
 * body spawned (a path-less `patrol` walks from it); `rng` is the brain's own seeded draw. An
 * `initial` that names no state starts in the first.
 */
export function createBrain(spec, { rng, at }) {
	if (!spec.states.length) throw new Error('behaviours: a brain needs at least one state');
	const brain = {
		spec,
		state: '',
		time: 0,
		memory: {},
		rolls: {},
		rng,
		at: { x: at.x, y: at.y },
	};
	enter(brain, stateOf(brain, spec.initial) ? spec.initial : spec.states[0].id);
	return brain;
}

/**
 * The world one character's brain sees this step. `nearest` and `touching` skip the body itself;
 * distances are centre to centre and a tie goes to the body listed first. `hitSolid` is whether the
 * character's own last `stepSolid` stopped it.
 */
export function createBrainWorld({ self, bodies, hitSolid = false, paths = {}, variable }) {
	const tagged = (body, tag) => Array.isArray(body.tags) && body.tags.includes(tag);
	return {
		self,
		bodies,
		hitSolid,
		paths,
		variable: variable ?? (() => undefined),
		nearest(from, tag) {
			let found;
			for (const body of bodies) {
				if (body === from || !tagged(body, tag)) continue;
				const distance = Math.hypot(body.x - from.x, body.y - from.y);
				if (!found || distance < found.distance) found = { body, distance };
			}
			return found;
		},
		touching(from, tag) {
			return bodies.some((body) => body !== from && tagged(body, tag) && touching(from, body));
		},
	};
}

function compare(left, op, right) {
	switch (op) {
		case '==':
			return left === right;
		case '!=':
			return left !== right;
	}
	if (typeof left !== 'number' || typeof right !== 'number') return false;
	switch (op) {
		case '<':
			return left < right;
		case '<=':
			return left <= right;
		case '>':
			return left > right;
		case '>=':
			return left >= right;
		default:
			return false;
	}
}

/** A `random` condition rolls once each time the state's clock crosses a multiple of `every`. */
function rolled(brain, condition, key) {
	const every =
		Number.isFinite(condition.every) && condition.every > 0 ? condition.every : RANDOM_EVERY;
	const tick = Math.floor((brain.time + CLOCK_EPSILON) / every);
	if (tick <= (brain.rolls[key] ?? 0)) return false;
	brain.rolls[key] = tick;
	return brain.rng() < condition.chance;
}

function holds(brain, world, condition, key) {
	const self = world.self;
	switch (condition.kind) {
		case 'targetWithin': {
			const near = world.nearest(self, condition.tag);
			return near !== undefined && near.distance <= condition.px;
		}
		case 'targetBeyond': {
			const near = world.nearest(self, condition.tag);
			return near === undefined || near.distance > condition.px;
		}
		case 'touching':
			return world.touching(self, condition.tag);
		case 'hitSolid':
			return world.hitSolid === true;
		case 'timer':
			return brain.time + CLOCK_EPSILON >= condition.ms;
		case 'variable':
			return compare(world.variable(condition.id), condition.op, condition.value);
		case 'random':
			return rolled(brain, condition, key);
		default:
			return false;
	}
}

/**
 * Advance a brain's clock by `dt` and fire at most one transition: the `*` ones first, then the
 * current state's, each in authored order; the first whose conditions all hold wins. A `*`
 * transition never re-enters the state it would leave. Every condition of a transition is evaluated
 * (a `random` one rolls on its beat even when another fails), so the draws do not depend on the
 * others' outcome. Entering a state zeroes its clock and memory. `world.self` is the character.
 */
export function stepBrain(brain, world, dt) {
	brain.time += dt * 1000;
	const { transitions } = brain.spec;
	const indices = transitions.map((_, i) => i);
	const order = [
		...indices.filter((i) => transitions[i].from === ANY && transitions[i].to !== brain.state),
		...indices.filter((i) => transitions[i].from === brain.state),
	];
	for (const index of order) {
		const transition = transitions[index];
		if (!stateOf(brain, transition.to)) continue;
		let all = true;
		transition.when.forEach((condition, i) => {
			if (!holds(brain, world, condition, `${index}:${i}`)) all = false;
		});
		if (!all) continue;
		const from = brain.state;
		enter(brain, transition.to);
		return { from, to: transition.to };
	}
	return undefined;
}

/** Put a brain in state `id` from outside (Flow's `character.setState`), re-entering it if it is
 *  already there. Returns the change, or `undefined` for an unknown state. */
export function setBrainState(brain, id) {
	if (!stateOf(brain, id)) return undefined;
	const from = brain.state;
	enter(brain, id);
	return { from, to: id };
}

const STILL = () => ({ vx: 0, vy: 0 });

/** Towards (dx, dy) at `speed`, arriving this step rather than overshooting. */
function towards(dx, dy, speed, dt) {
	const distance = Math.hypot(dx, dy);
	if (distance === 0) return STILL();
	if (distance <= speed * dt) return { vx: dx / dt, vy: dy / dt };
	return { vx: (dx / distance) * speed, vy: (dy / distance) * speed };
}

/**
 * Walk a path with a carrot: the target point `memory.d` px along it. Whenever the body is nearer
 * the target than the lead (this step's reach, at least {@link PATH_LEAD} px), the target moves on
 * to a lead ahead, so the body moves `speed` along the path, cutting a corner by at most the lead,
 * and a steered body that lags never circles a target it cannot quite reach. A body off the path
 * first heads for the target. At an end the target waits for the body: `pingPong` then turns back,
 * `once` is done on arrival. `mode` is `loop`, `pingPong` or `once`.
 */
function walkPath(memory, path, self, speed, dt, mode) {
	const reach = speed * dt;
	const lead = Math.max(reach, PATH_LEAD);
	let target = pointAt(path, memory.d);
	const distance = Math.hypot(target.x - self.x, target.y - self.y);
	if (path.length > 0 && distance < lead) {
		const atEnd = mode !== 'loop' && (memory.dir > 0 ? memory.d >= path.length : memory.d <= 0);
		if (atEnd && mode === 'pingPong' && distance < ARRIVED) memory.dir = -memory.dir;
		if (!atEnd || mode === 'pingPong') {
			const d = memory.d + memory.dir * (lead - distance);
			memory.d =
				mode === 'loop'
					? ((d % path.length) + path.length) % path.length
					: Math.min(Math.max(d, 0), path.length);
			target = pointAt(path, memory.d);
		}
		if (atEnd && mode === 'once' && distance < ARRIVED) memory.done = true;
	}
	if (memory.done) return STILL();
	return towards(target.x - self.x, target.y - self.y, speed, dt);
}

/** Set up a state's memory on its first step. A path it names that the world does not have yet
 *  leaves it unset, so a later step (once the layout's paths arrive) tries again. */
function initMemory(brain, state, params, self, world) {
	const memory = brain.memory;
	switch (state.behaviour) {
		case 'wander':
			memory.heading = brain.rng() * 2 * Math.PI;
			memory.left = params.turnEvery;
			break;
		case 'patrol': {
			const named = typeof params.path === 'string' ? world.paths[params.path] : undefined;
			const path =
				named ??
				(params.path === undefined
					? samplePath({
							points: [brain.at, { x: brain.at.x + params.dx, y: brain.at.y + params.dy }],
						})
					: undefined);
			if (!path) return;
			const pingPong = !path.closed && params.pingPong !== false;
			memory.path =
				pingPong || path.closed ? path : samplePath({ points: path.points, closed: true });
			memory.mode = pingPong ? 'pingPong' : 'loop';
			memory.d = nearestDistance(memory.path, self.x, self.y);
			memory.dir = 1;
			break;
		}
		case 'followPath': {
			const path = typeof params.path === 'string' ? world.paths[params.path] : undefined;
			if (!path) return;
			memory.path = path;
			memory.mode = path.closed ? 'loop' : 'once';
			memory.d = 0;
			memory.dir = 1;
			break;
		}
		case 'hover':
			memory.origin = { x: self.x, y: self.y };
			break;
		case 'shootAt':
			memory.nextShot = 0;
			break;
	}
	memory.ready = true;
}

/**
 * The current behaviour's desired velocity for `self` this step, and for `shootAt` the shot it asks
 * the loop to spawn. A behaviour never moves the body; it may update the brain's memory.
 */
export function brainVelocity(brain, self, world, dt) {
	const state = stateOf(brain, brain.state);
	if (!state || !(dt > 0)) return STILL();
	const params = paramsOf(state);
	const memory = brain.memory;
	if (!memory.ready) initMemory(brain, state, params, self, world);
	switch (state.behaviour) {
		case 'wander': {
			memory.left -= dt * 1000;
			if (world.hitSolid || memory.left <= CLOCK_EPSILON) {
				memory.heading = brain.rng() * 2 * Math.PI;
				if (memory.left <= CLOCK_EPSILON) memory.left += Math.max(params.turnEvery, dt * 1000);
			}
			const speed = Math.max(0, params.speed);
			return { vx: Math.cos(memory.heading) * speed, vy: Math.sin(memory.heading) * speed };
		}
		case 'patrol':
		case 'followPath':
			if (!memory.path || memory.done) return STILL();
			return walkPath(memory, memory.path, self, Math.max(0, params.speed), dt, memory.mode);
		case 'chase': {
			const near = world.nearest(self, params.tag);
			if (!near || near.distance > params.range) return STILL();
			return towards(near.body.x - self.x, near.body.y - self.y, Math.max(0, params.speed), dt);
		}
		case 'flee': {
			const near = world.nearest(self, params.tag);
			if (!near || near.distance > params.range) return STILL();
			const speed = Math.max(0, params.speed);
			if (near.distance === 0) return { vx: speed, vy: 0 };
			return {
				vx: ((self.x - near.body.x) / near.distance) * speed,
				vy: ((self.y - near.body.y) / near.distance) * speed,
			};
		}
		case 'keepDistance': {
			const near = world.nearest(self, params.tag);
			if (!near || near.distance === 0) return STILL();
			const ux = (near.body.x - self.x) / near.distance;
			const uy = (near.body.y - self.y) / near.distance;
			const gap = near.distance - params.distance;
			return towards(ux * gap, uy * gap, Math.max(0, params.speed), dt);
		}
		case 'hover': {
			const period = params.period > 0 ? params.period : BEHAVIOUR_DEFAULTS.hover.period;
			const offset = params.amplitude * Math.sin((2 * Math.PI * brain.time) / period);
			const x = memory.origin.x + (params.axis === 'x' ? offset : 0);
			const y = memory.origin.y + (params.axis === 'x' ? 0 : offset);
			return { vx: (x - self.x) / dt, vy: (y - self.y) / dt };
		}
		case 'shootAt': {
			const component = stringParam(params, 'component', '');
			const layer = stringParam(params, 'layer', '');
			if (!component || !layer || brain.time + CLOCK_EPSILON < memory.nextShot) return STILL();
			const near = world.nearest(self, params.tag);
			if (!near || near.distance > params.range) return STILL();
			memory.nextShot = brain.time + Math.max(params.every, 0);
			const speed = Math.max(0, params.speed);
			const ux = near.distance > 0 ? (near.body.x - self.x) / near.distance : 1;
			const uy = near.distance > 0 ? (near.body.y - self.y) / near.distance : 0;
			return {
				vx: 0,
				vy: 0,
				spawn: { component, layer, x: self.x, y: self.y, vx: ux * speed, vy: uy * speed },
			};
		}
		default:
			return STILL();
	}
}

/**
 * A player's desired velocity from a controller. `topDown` reads left/right/up/down (a diagonal at
 * the same speed as a straight line); `sideScroll` left/right only. With none of its keys held, a
 * keyboard controller follows a pressed pointer instead (touch steering): `topDown` on both axes,
 * `sideScroll` across, at its speed, arriving rather than overshooting. `pointer` heads for the
 * pointer on its axes at `speed` (absent ⇒ `movement.maxSpeed`) and arrives within the step rather
 * than overshooting — with neither, it snaps to it. No pointer, no movement.
 */
export function controllerVelocity(controller, input, self, movement, dt) {
	switch (controller.kind) {
		case 'topDown':
		case 'sideScroll': {
			const across = controller.kind === 'topDown' ? CONTROLLER_ACTIONS : ['left', 'right'];
			if (!across.some((action) => input.held(action))) {
				const pointer = input.pointer();
				if (!pointer || !(dt > 0)) return STILL();
				const dy = controller.kind === 'topDown' ? pointer.y - self.y : 0;
				return towards(pointer.x - self.x, dy, Math.max(0, controller.speed), dt);
			}
			let x = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
			if (controller.kind === 'sideScroll') return { vx: x * controller.speed, vy: 0 };
			let y = (input.held('down') ? 1 : 0) - (input.held('up') ? 1 : 0);
			if (x !== 0 && y !== 0) {
				x *= Math.SQRT1_2;
				y *= Math.SQRT1_2;
			}
			return { vx: x * controller.speed, vy: y * controller.speed };
		}
		case 'pointer': {
			const pointer = input.pointer();
			if (!pointer || !(dt > 0)) return STILL();
			const dx = controller.axes === 'y' ? 0 : pointer.x - self.x;
			const dy = controller.axes === 'x' ? 0 : pointer.y - self.y;
			const speed = controller.speed ?? movement?.maxSpeed;
			if (speed === undefined) return { vx: dx / dt, vy: dy / dt };
			return towards(dx, dy, Math.max(0, speed), dt);
		}
		default:
			return STILL();
	}
}
