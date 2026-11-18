/**
 * The Crash bot's brain (`docs/design/3d/gameplay-evaluation.md` §3 "Bots"): a room player whose
 * input comes from here instead of a device, stepped by the room like any other player.
 *
 * BOTY's `AIController` targets an enemy, chases it, attacks in range with line of sight and else
 * wanders; it never carries. Ours also carries a piece (or a corpse) to the pit and escorts its own
 * team's carriers or intercepts the other team's — behind the `carry` switch, on by default. Each
 * step the brain scores its options by a per-hero weight over distance, keeps its current goal
 * unless another beats it by a margin, walks to it on the level's nav graph (`nav3d.js`) and
 * attacks any enemy in reach it can see (the nav graph's segment test, the one hitscan uses).
 *
 * Plain, dependency-free ESM, SERVER-ONLY (a device interpolates bots and never runs this), seeded:
 * every draw comes from the bot's own rng, so a room's bots replay exactly from the room's seed.
 * The rules hand it a `situation` (`{ players, pieces, pit }`), so it needs nothing of their shape.
 */

import { createRng } from './board.js';
import { MOVE_SCALE, YAW_UNITS } from './motion3d.js';
import {
	createPathFollower3d,
	findPath3d,
	followPath3d,
	lineOfSight3d,
	nearestNode3d,
	pathDone3d,
	setPath3d,
} from './nav3d.js';
import { BUTTONS3D, sanitizeInput3d } from './online3d.js';

/** The brain's numbers when the config leaves them out. Distances in m. */
export const CRASH_BOT_DEFAULTS = Object.freeze({
	carry: true,
	sight: 30,
	attackRange: 2,
	eye: 1.5,
	repathSteps: 20,
	wanderRadius: 12,
	pickupRange: 1.5,
	escortDistance: 3,
	weights: Object.freeze({ fight: 1, carry: 1.2, escort: 0.6, intercept: 1, wander: 0.15 }),
});

/** The goals the brain picks between. */
export const CRASH_GOALS = ['wander', 'fight', 'carry', 'score', 'escort', 'intercept'];

/** A goal's score has to beat the current one's by this factor to take over. */
const STICKY = 1.25;
/** A goal this far (m) from where its path was planned to gets a new path. */
const MOVED_M = 1.5;

/**
 * The resolved options for a hero: `base` (a config's `crash` block over {@link CRASH_BOT_DEFAULTS})
 * with `base.heroes[characterId]` on top; `weights` merge key by key.
 */
export function crashOptionsFor(base, characterId) {
	const merged = { ...CRASH_BOT_DEFAULTS, ...base };
	const hero = base?.heroes?.[characterId] ?? {};
	const out = { ...merged, ...hero };
	out.weights = { ...CRASH_BOT_DEFAULTS.weights, ...base?.weights, ...hero.weights };
	delete out.heroes;
	return Object.freeze(out);
}

/** A Crash bot: its options, its own seeded rng, its path follower, the `seq` of its next input. */
export function createCrashBot3d({ seed, options = CRASH_BOT_DEFAULTS }) {
	return {
		options,
		rng: createRng(seed),
		follower: createPathFollower3d(),
		seq: 0,
		blocked: false,
		goal: null,
		planned: null,
		plannedAt: -Infinity,
		swing: false,
		grab: false,
		jumpHeld: false,
		steps: 0,
	};
}

const dist2 = (a, b) => {
	const dx = a.x - b.x;
	const dz = a.z - b.z;
	return dx * dx + dz * dz;
};
const planar = (a, b) => Math.sqrt(dist2(a, b));
const near = (d, weight) => weight / (1 + d / 10);

const yawAlong = (vx, vz) => {
	const units = Math.round((Math.atan2(-vx, -vz) / (2 * Math.PI)) * YAW_UNITS) % YAW_UNITS;
	return units < 0 ? units + YAW_UNITS : units;
};

/** The options this step, scored: `[{ kind, score, at, id? }]`. */
function goalsOf(bot, self, situation, nav, level) {
	const o = bot.options;
	const w = o.weights;
	const me = self.body;
	const eyeY = me.y + o.eye;
	const goals = [];
	const pieces = o.carry ? (situation.pieces ?? []) : [];
	const pit = o.carry ? situation.pit : null;
	const carrying = pieces.find((p) => p.carrier === self.id);
	if (carrying && pit) {
		goals.push({ kind: 'score', score: Infinity, at: pit, id: carrying.id });
		return goals;
	}
	for (const p of pieces) {
		if (p.carrier) continue;
		goals.push({ kind: 'carry', score: near(planar(me, p), w.carry), at: p, id: p.id });
	}
	for (const other of situation.players) {
		if (other === self || !other.connected || other.status !== 0) continue;
		const d = planar(me, other.body);
		const carrier = pieces.find((p) => p.carrier === other.id);
		if (other.team === self.team) {
			if (carrier)
				goals.push({ kind: 'escort', score: near(d, w.escort), at: other.body, id: other.id });
			continue;
		}
		if (carrier) {
			goals.push({ kind: 'intercept', score: near(d, w.intercept), at: other.body, id: other.id });
			continue;
		}
		if (d > o.sight) continue;
		const b = other.body;
		const seen = lineOfSight3d(level, me.x, eyeY, me.z, b.x, b.y + o.eye, b.z);
		goals.push({ kind: 'fight', score: near(d, w.fight) * (seen ? 1 : 0.5), at: b, id: other.id });
	}
	goals.push({ kind: 'wander', score: w.wander, at: null });
	return goals;
}

const sameGoal = (a, b) => a && b && a.kind === b.kind && a.id === b.id;

/** A random node within the wander radius the bot can reach (the bot's own rng), or −1. */
function wanderNode(bot, nav, from) {
	const start = nav.nodes[from];
	for (let tries = 0; tries < 12; tries++) {
		const id = Math.floor(bot.rng() * nav.nodes.length);
		const n = nav.nodes[id];
		if (n.trampoline < 0 && planar(n, start) <= bot.options.wanderRadius) return id;
	}
	return -1;
}

/**
 * The bot's input for the next step. `self` is its room player (`{ id, body, team, status,
 * connected }`), `situation` what the rules show it: `players` (everyone in the room), `pieces`
 * (`[{ id, x, y, z, carrier }]`, `carrier` a player id or null; corpses included) and `pit` (`{ x,
 * y, z }` or null). `nav` is the level's {@link createNavGrid3d} graph, `level` the `motion3d`
 * level, `spec` the bot's motion. The move is made from the follower's velocity exactly as
 * `botInput3d` makes one from a brain's: scaled to `spec.speed`, facing where it goes (or the enemy
 * it swings at), jumping on a `jump` edge or when a wall stopped it.
 */
export function crashBotInput3d(bot, self, situation, { nav, level, dt, spec, view }) {
	const o = bot.options;
	const me = self.body;
	bot.steps += 1;
	const players = [...situation.players];
	const goals = goalsOf(bot, self, { ...situation, players }, nav, level);
	let pick = goals[0];
	for (const g of goals) if (g.score > pick.score) pick = g;
	const current = goals.find((g) => sameGoal(g, bot.goal));
	if (current && current !== pick && current.score * STICKY >= pick.score) pick = current;
	const changed = !sameGoal(pick, bot.goal);
	bot.goal = { kind: pick.kind, id: pick.id };

	const from = nearestNode3d(nav, me.x, me.y, me.z);
	const replan =
		changed ||
		bot.follower.lost ||
		(pick.at &&
			bot.planned &&
			planar(pick.at, bot.planned) > MOVED_M &&
			bot.steps - bot.plannedAt >= o.repathSteps) ||
		(pick.kind === 'wander' && pathDone3d(bot.follower));
	if (replan && from >= 0) {
		const to = pick.at
			? nearestNode3d(nav, pick.at.x, pick.at.y + 0.5, pick.at.z, { reach: 3 })
			: wanderNode(bot, nav, from);
		const goalAt = pick.at ? { x: pick.at.x, z: pick.at.z } : null;
		const path = to >= 0 ? findPath3d(nav, from, to, bot.rng) : null;
		setPath3d(bot.follower, path, path?.reached ? goalAt : null);
		bot.planned = pick.at ? { x: pick.at.x, z: pick.at.z } : null;
		bot.plannedAt = bot.steps;
	}

	let v = followPath3d(bot.follower, me, nav, dt);
	const target = pick.at;
	const d = target ? planar(me, target) : Infinity;
	if (pick.kind === 'escort' && d < o.escortDistance) v = { vx: 0, vz: 0, jump: false };
	else if ((pick.kind === 'fight' || pick.kind === 'intercept') && d < o.attackRange && target) {
		const k = Math.min(1, d) * spec.speed;
		v = {
			vx: d > 0 ? ((target.x - me.x) / d) * k : 0,
			vz: d > 0 ? ((target.z - me.z) / d) * k : 0,
			jump: false,
		};
	}

	let buttons = 0;
	let face = null;
	let nearest = Infinity;
	for (const other of players) {
		if (other === self || other.team === self.team || !other.connected || other.status !== 0)
			continue;
		const b = other.body;
		const dx = b.x - me.x;
		const dy = b.y - me.y;
		const dz = b.z - me.z;
		const reach = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (reach > o.attackRange || reach >= nearest) continue;
		if (!lineOfSight3d(level, me.x, me.y + o.eye, me.z, b.x, b.y + o.eye, b.z)) continue;
		nearest = reach;
		face = b;
	}
	if (face) {
		bot.swing = !bot.swing;
		if (bot.swing) buttons |= BUTTONS3D.attack;
	} else bot.swing = false;
	if (pick.kind === 'carry' && d <= o.pickupRange) {
		bot.grab = !bot.grab;
		if (bot.grab) buttons |= BUTTONS3D.interact;
	} else bot.grab = false;
	const moving = v.vx !== 0 || v.vz !== 0;
	const wantJump = v.jump || (bot.blocked && moving);
	const press = wantJump && !bot.jumpHeld;
	bot.jumpHeld = press;
	if (press) buttons |= BUTTONS3D.jump;

	const scale = spec.speed > 0 ? MOVE_SCALE / spec.speed : 0;
	const yaw = face
		? yawAlong(face.x - me.x, face.z - me.z)
		: moving
			? yawAlong(v.vx, v.vz)
			: me.yaw;
	bot.seq += 1;
	return sanitizeInput3d({
		seq: bot.seq,
		moveX: v.vx * scale,
		moveZ: v.vz * scale,
		buttons,
		yaw,
		pitch: 0,
		view,
	});
}
