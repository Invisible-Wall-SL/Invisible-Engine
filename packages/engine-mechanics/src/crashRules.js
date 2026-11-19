/**
 * CRASH, the rules of an online 3D room (`docs/design/3d/gameplay-evaluation.md` §1, §3, §6 steps
 * 3–4): BattleOTtheYear's Crash mode rebuilt as data on a server-authoritative room. Red against
 * blue for a timed round; carriable pieces and corpses thrown into the pit score for the team of
 * whoever carried them last and raise the pit; heroes have health and shields and hit with melee,
 * hitscan or projectile weapons, judged where the attacker's device was drawing its targets.
 *
 * SERVER ONLY. `services/game-server` `roomSim3d.ts` runs it (for a config whose `arcade.world3d`
 * carries a `rules` block naming `module: 'crash'`); a device runs none of it and draws what the
 * room reports. Nothing here is in `index.ts`, so no runtime bundles it. Trigonometry is allowed:
 * nothing here is in a device's predicted path. Every choice is a function of the room's inputs,
 * so a room replays bit for bit from the same inputs and seed (`scripts/check-crash-rules.mjs`).
 *
 * Read from BOTY (`Assets/_Project/Scripts`):
 * - `CrashMatchController.cs`: `MatchTimer = 180f`, one round, red (0) and blue (1); a joiner takes
 *   the smaller team, red on a tie (`redCount <= blueCount`, already the room's `nextTeam`).
 * - `CarriablePiece.cs` / `PlayerController.cs`: an interact press picks the piece in reach
 *   (`_interactRange = 2.5`) up, the next throws it (`_throwForce = 15`), dying drops it
 *   (`Throw(forward, 1)`); `LastCarrierClientId` names who carried it last.
 * - `ThePit.cs`: a piece in the pit scores `ScoreValue` (1) for its last carrier's team and raises
 *   the pit by `_riseAmountPerScore = 0.1` up to `_maxHeight = 5`; a scored corpse respawns its
 *   player after 3 s (`DestroyCorpseAndScore(3.0f)`), a scored piece is gone.
 * - `Health.cs`: a dead red player is a corpse that lies 10 s (`_corpseTimeRemaining`, paused while
 *   carried) before its player respawns; a dead blue one respawns after 3 s; a kill by a red player
 *   scores 1 for red (`attackerPC.TeamIndex.Value == 0`), by a blue one nothing. `VoidZone.cs` and
 *   `DeathPlaneTrigger.cs` kill outright. These asymmetries are BOTY's and are data here
 *   (`corpseTeams`, `killScore`), not code.
 * - `WeaponConfig.cs` / `Resources/Weapons/*.asset`: `Type` (Hitscan, Projectile, Melee),
 *   `FireRate`, `Damage`, `Range`, `Automatic`, `ProjectileSpeed`; a hit pushes by the shot's
 *   direction × 10 (`PlayerWeaponController.cs`, `Projectile.cs`); projectiles fly straight and
 *   spare the shooter's team. `HeroConfig.cs` / `Resources/Heroes/*.asset`: `MaxHealth`,
 *   `MaxMana`, `MaxShields`, `StartingWeapons` (`MoveSpeed` is the motion's `speed`,
 *   `arcade.world3d.characters`).
 *
 * What is ours, not BOTY's (it trusted its clients): every hit is decided here, against where the
 * attacker's device drew the target (`input.view`, held to {@link REWIND_MS}); melee is a sector
 * (plane reach, a height band, the cosine of half its arc precomputed) instead of physics casts;
 * hitscan is a ray against upright cylinders, stopped by the level; a knockback is an impulse the
 * victim's device applies at the input it follows (`knockback` event, `online3d.js`
 * `createPredictor3d` `impulse`); a shield soaks damage before health.
 */

import { createBody3d, stepBody3d, zonesAt3d } from './motion3d.js';
import { STATUS3D } from './online3d.js';
import { REWIND_MS } from './onlineRules.js';

export { REWIND_MS, STATUS3D };

/** Team index → name, as events and the round's winner name them. */
export const TEAMS = Object.freeze(['red', 'blue']);

/** `Entity.state`. */
export const ENTITY_STATE = Object.freeze({ resting: 0, carried: 1, flying: 2 });

/** The kinds of entity a player can carry. */
export const CARRIABLE = Object.freeze(['piece', 'corpse']);

export const WEAPON_TYPES = Object.freeze(['hitscan', 'projectile', 'melee']);

/** BOTY's weapons (`Resources/Weapons/*.asset`), the default `rules.weapons`. */
export const BOTY_WEAPONS = Object.freeze({
	Barbarian_Sword: { type: 'melee', fireRate: 0.5, damage: 50, range: 2, automatic: true },
	Rifle: { type: 'hitscan', fireRate: 0.15, damage: 10, range: 100, automatic: true },
	Blaster: {
		type: 'projectile',
		fireRate: 0.15,
		damage: 10,
		range: 100,
		automatic: true,
		projectileSpeed: 40,
	},
	Bow: {
		type: 'projectile',
		fireRate: 0.8,
		damage: 30,
		range: 100,
		automatic: true,
		projectileSpeed: 30,
	},
});

/** BOTY's heroes (`Resources/Heroes/*.asset`; `StartingWeapons` by `WeaponId`). */
export const BOTY_HEROES = Object.freeze({
	Warrior: { maxHealth: 100, maxMana: 100, maxShields: 0, startingWeapons: ['Barbarian_Sword'] },
	Barbarian: { maxHealth: 100, maxMana: 100, maxShields: 0, startingWeapons: ['Barbarian_Sword'] },
	Archer: { maxHealth: 8, maxMana: 0, maxShields: 0, startingWeapons: ['Bow'] },
	Gunmen: { maxHealth: 10, maxMana: 0, maxShields: 5, startingWeapons: ['Rifle'] },
	Cleric: { maxHealth: 8, maxMana: 10, maxShields: 0, startingWeapons: ['Blaster'] },
	Wizard: { maxHealth: 6, maxMana: 12, maxShields: 0, startingWeapons: ['Blaster'] },
	Necromancer: { maxHealth: 6, maxMana: 12, maxShields: 0, startingWeapons: ['Blaster'] },
});

const WEAPON_DEFAULTS = Object.freeze({
	fireRate: 0.5,
	damage: 10,
	range: 2,
	automatic: true,
	projectileSpeed: 20,
	/** The push of a hit, m/s along the shot (BOTY: direction × 10). */
	hitForce: 10,
	/** The share of `hitForce` that lifts the victim, so the push carries off the ground. */
	knockUp: 0.4,
	/** Melee: the sector's whole arc, degrees, and how far above or below its target may stand. */
	arc: 100,
	heightBand: 1.5,
	/** Projectile: its radius, its gravity (BOTY's fly straight: 0) and its splash radius. */
	projectileRadius: 0.1,
	projectileGravity: 0,
	splashRadius: 0,
});

const HERO_DEFAULTS = Object.freeze({
	maxHealth: 100,
	maxMana: 0,
	maxShields: 0,
	startingWeapons: ['Barbarian_Sword'],
});

/** The `rules` block's defaults: BOTY's numbers. */
export const CRASH_DEFAULTS = Object.freeze({
	roundSeconds: 180,
	nextRoundSeconds: 10,
	interactRange: 2.5,
	/** How far above or below a carrier's middle a piece may lie and still be picked up, m. */
	interactHeight: 2,
	throwSpeed: 8,
	/** Added straight up to a throw, m/s, so a level throw arcs. */
	throwLift: 3,
	/** A carried piece rides this high above its carrier's feet, and this far ahead, m. */
	carryHeight: 2,
	carryAhead: 0.3,
	pitRise: 0.1,
	pitMax: 5,
	/** Teams whose dead leave a carriable corpse (BOTY: red only). */
	corpseTeams: [0],
	/** A corpse not carried for this long respawns its player, s. */
	corpseSeconds: 10,
	/** A scored corpse respawns its player this long after, s. */
	corpseScoredSeconds: 3,
	/** A death that leaves no corpse respawns after this long, s. */
	respawnSeconds: 3,
	/** A respawned player cannot be hurt for this long, s. */
	spawnGraceSeconds: 1,
	/** What a kill scores for the killer's team, by team (BOTY: red 1, blue 0). */
	killScore: [1, 0],
	/** A scored piece comes back at its spawn after this long, s (BOTY's are gone: props drop new ones). */
	pieceRespawnSeconds: 5,
	/** A carrier whose device dropped, or that sent no input for this long, s (the room's
	 *  `silent`, which a server stall's catch-up steps do not add to), lets go of what it carries:
	 *  a stalled carrier must not hold a piece out of play. */
	carryStallSeconds: 1,
	friendlyFire: false,
	eyeHeight: 1.6,
	/** Piece physics: friction on the ground, m/s², and how much of its speed a bounce keeps. */
	pieceFriction: 8,
	pieceBounce: 0.35,
	/** The piece spawns (`{ x, y, z, score? }`). */
	pieces: [],
	weapons: BOTY_WEAPONS,
	heroes: BOTY_HEROES,
});

const PIECE_RADIUS = 0.3;
const PIECE_HEIGHT = 0.5;
const CORPSE_RADIUS = 0.4;
const CORPSE_HEIGHT = 0.4;
/** A bounce slower than this, m/s, settles instead. */
const SETTLE_SPEED = 1.5;
/** A piece slower than this on the ground, m/s, sleeps until moved. */
const SLEEP_SPEED = 1e-3;
const MAX_PIECES = 256;
const MAX_ENTITIES = 1024;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

const numberAt = (raw, key, fallback, path, test = () => true) => {
	const v = raw[key];
	if (v === undefined) return fallback;
	if (typeof v !== 'number' || !Number.isFinite(v) || !test(v))
		throw new Error(`${path}.${key}: not a valid number`);
	return v;
};

const nonNegative = (v) => v >= 0;
const positive = (v) => v > 0;

function weaponOf(raw, path) {
	if (!isObject(raw)) throw new Error(`${path}: not an object`);
	if (!WEAPON_TYPES.includes(raw.type)) throw new Error(`${path}.type: ${WEAPON_TYPES.join(', ')}`);
	const w = { type: raw.type };
	for (const key of Object.keys(WEAPON_DEFAULTS)) {
		if (key === 'automatic') {
			if (raw.automatic !== undefined && typeof raw.automatic !== 'boolean')
				throw new Error(`${path}.automatic: true or false`);
			w.automatic = raw.automatic ?? WEAPON_DEFAULTS.automatic;
			continue;
		}
		const test =
			key === 'arc'
				? (v) => v > 0 && v <= 360
				: key === 'projectileGravity'
					? () => true
					: key === 'fireRate' || key === 'range' || key === 'projectileSpeed'
						? positive
						: nonNegative;
		w[key] = numberAt(raw, key, WEAPON_DEFAULTS[key], path, test);
	}
	return Object.freeze(w);
}

function heroOf(raw, weapons, path) {
	if (!isObject(raw)) throw new Error(`${path}: not an object`);
	const hero = {
		maxHealth: numberAt(raw, 'maxHealth', HERO_DEFAULTS.maxHealth, path, positive),
		maxMana: numberAt(raw, 'maxMana', HERO_DEFAULTS.maxMana, path, nonNegative),
		maxShields: numberAt(raw, 'maxShields', HERO_DEFAULTS.maxShields, path, nonNegative),
	};
	const list = raw.startingWeapons ?? HERO_DEFAULTS.startingWeapons;
	if (!Array.isArray(list) || !list.length || list.some((id) => !Object.hasOwn(weapons, id)))
		throw new Error(`${path}.startingWeapons: a list of weapon ids (${Object.keys(weapons)})`);
	hero.startingWeapons = Object.freeze([...list]);
	return Object.freeze(hero);
}

/**
 * The Crash rules of a raw `arcade.world3d.rules` block — `undefined` when there is none, else
 * {@link CRASH_DEFAULTS} with the block's overrides, checked, or a thrown `Error` naming the first
 * bad path. `weapons` and `heroes` replace BOTY's whole when given; a hero is looked up by the
 * player's `arcade.online.characters` id, falling back to `defaultHero` (default: the first).
 */
export function crashRulesOf(raw) {
	if (raw === undefined || raw === null) return undefined;
	const path = 'arcade.world3d.rules';
	if (!isObject(raw)) throw new Error(`${path}: not an object`);
	if (raw.module !== 'crash') throw new Error(`${path}.module: crash`);
	const rules = { module: 'crash' };
	for (const [key, fallback] of Object.entries(CRASH_DEFAULTS)) {
		if (typeof fallback !== 'number') continue;
		const test = key === 'roundSeconds' || key === 'throwSpeed' ? positive : nonNegative;
		rules[key] = numberAt(raw, key, fallback, path, test);
	}
	if (raw.friendlyFire !== undefined && typeof raw.friendlyFire !== 'boolean')
		throw new Error(`${path}.friendlyFire: true or false`);
	rules.friendlyFire = raw.friendlyFire ?? CRASH_DEFAULTS.friendlyFire;
	const corpseTeams = raw.corpseTeams ?? CRASH_DEFAULTS.corpseTeams;
	if (!Array.isArray(corpseTeams) || corpseTeams.some((t) => t !== 0 && t !== 1))
		throw new Error(`${path}.corpseTeams: a list of 0 (red) and 1 (blue)`);
	rules.corpseTeams = Object.freeze([...corpseTeams]);
	const killScore = raw.killScore ?? CRASH_DEFAULTS.killScore;
	if (
		!Array.isArray(killScore) ||
		killScore.length !== 2 ||
		killScore.some((v) => typeof v !== 'number' || !Number.isInteger(v) || v < 0)
	)
		throw new Error(`${path}.killScore: [red, blue], whole numbers`);
	rules.killScore = Object.freeze([...killScore]);
	const pieces = raw.pieces ?? [];
	if (!Array.isArray(pieces) || pieces.length > MAX_PIECES)
		throw new Error(`${path}.pieces: a list of at most ${MAX_PIECES} places`);
	rules.pieces = Object.freeze(
		pieces.map((p, i) => {
			const at = `${path}.pieces.${i}`;
			if (!isObject(p)) throw new Error(`${at}: not an object`);
			return Object.freeze({
				x: numberAt(p, 'x', 0, at),
				y: numberAt(p, 'y', 0, at),
				z: numberAt(p, 'z', 0, at),
				score: numberAt(p, 'score', 1, at, (v) => Number.isInteger(v) && v >= 0),
			});
		}),
	);
	const weaponsRaw = raw.weapons ?? BOTY_WEAPONS;
	if (!isObject(weaponsRaw) || !Object.keys(weaponsRaw).length)
		throw new Error(`${path}.weapons: weapon id → weapon`);
	const weapons = {};
	for (const [id, w] of Object.entries(weaponsRaw))
		weapons[id] = weaponOf(w, `${path}.weapons.${id}`);
	rules.weapons = Object.freeze(weapons);
	const heroesRaw = raw.heroes ?? BOTY_HEROES;
	if (!isObject(heroesRaw) || !Object.keys(heroesRaw).length)
		throw new Error(`${path}.heroes: character id → hero`);
	const heroes = {};
	for (const [id, h] of Object.entries(heroesRaw))
		heroes[id] = heroOf(h, weapons, `${path}.heroes.${id}`);
	rules.heroes = Object.freeze(heroes);
	const defaultHero = raw.defaultHero ?? Object.keys(heroes)[0];
	if (!Object.hasOwn(heroes, defaultHero)) throw new Error(`${path}.defaultHero: a hero id`);
	rules.defaultHero = defaultHero;
	return Object.freeze(rules);
}

// --- geometry -------------------------------------------------------------------------------

const TURN = 2 * Math.PI;
const YAW_UNITS = 65536;

/** The unit direction of a yaw and pitch (uint16 / int16 units): yaw 0 looks down −z, anticlockwise
 *  seen from above; pitch up positive. */
export function aimDirection(yaw, pitch = 0) {
	const theta = (yaw / YAW_UNITS) * TURN;
	const phi = (pitch / YAW_UNITS) * TURN;
	const c = Math.cos(phi);
	return { x: -Math.sin(theta) * c, y: Math.sin(phi), z: -Math.cos(theta) * c };
}

/** The ray's `[t0, t1]` inside an axis-aligned box, or `null`. */
function slab(ox, oy, oz, dx, dy, dz, c) {
	let t0 = -Infinity;
	let t1 = Infinity;
	const axes = [
		[ox, dx, c.minX, c.maxX],
		[oy, dy, c.minY, c.maxY],
		[oz, dz, c.minZ, c.maxZ],
	];
	for (const [o, d, lo, hi] of axes) {
		if (d === 0) {
			if (o < lo || o > hi) return null;
			continue;
		}
		let a = (lo - o) / d;
		let b = (hi - o) / d;
		if (a > b) [a, b] = [b, a];
		if (a > t0) t0 = a;
		if (b < t1) t1 = b;
		if (t0 > t1) return null;
	}
	return [t0, t1];
}

/** The ray's entry into a collider (a box, or a ramp's wedge under its surface), or `Infinity`. */
function rayCollider(ox, oy, oz, dx, dy, dz, c) {
	const span = slab(ox, oy, oz, dx, dy, dz, c);
	if (!span) return Infinity;
	let [t0, t1] = span;
	if (c.rise >= 0) {
		// Below the surface: f(t) = y - surface(x, z) <= 0, linear in t.
		let f0;
		let fd;
		switch (c.rise) {
			case 0:
				f0 = oy - (c.minY + (ox - c.minX) * c.slope);
				fd = dy - dx * c.slope;
				break;
			case 1:
				f0 = oy - (c.minY + (c.maxX - ox) * c.slope);
				fd = dy + dx * c.slope;
				break;
			case 2:
				f0 = oy - (c.minY + (oz - c.minZ) * c.slope);
				fd = dy - dz * c.slope;
				break;
			default:
				f0 = oy - (c.minY + (c.maxZ - oz) * c.slope);
				fd = dy + dz * c.slope;
		}
		if (fd === 0) {
			if (f0 > 0) return Infinity;
		} else {
			const tc = -f0 / fd;
			if (fd > 0) t1 = Math.min(t1, tc);
			else t0 = Math.max(t0, tc);
		}
		if (t0 > t1) return Infinity;
	}
	if (t1 < 0) return Infinity;
	return Math.max(0, t0);
}

/**
 * Where a ray first meets the level, as its `t` (the direction is a unit vector, so metres), or
 * `Infinity` within `maxT`: a grid walk over the level's collider columns (Amanatides–Woo on the
 * plane), each collider tested once, stopping at the first column whose nearest hit is before the
 * column's exit.
 */
export function rayLevel3d(level, ox, oy, oz, dx, dy, dz, maxT) {
	const size = level.cellSize;
	let cx = Math.floor(ox / size);
	let cz = Math.floor(oz / size);
	const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
	const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
	const nextX = stepX > 0 ? (cx + 1) * size : cx * size;
	const nextZ = stepZ > 0 ? (cz + 1) * size : cz * size;
	let tMaxX = stepX ? (nextX - ox) / dx : Infinity;
	let tMaxZ = stepZ ? (nextZ - oz) / dz : Infinity;
	const tDeltaX = stepX ? size / Math.abs(dx) : Infinity;
	const tDeltaZ = stepZ ? size / Math.abs(dz) : Infinity;
	const seen = new Set();
	let best = Infinity;
	for (let guard = 0; guard < 100000; guard++) {
		const bucket = level.cells.get(`${cx},${cz}`);
		if (bucket)
			for (const id of bucket) {
				if (seen.has(id)) continue;
				seen.add(id);
				const t = rayCollider(ox, oy, oz, dx, dy, dz, level.colliders[id]);
				if (t < best) best = t;
			}
		const exit = Math.min(tMaxX, tMaxZ);
		if (best <= exit || exit > maxT) break;
		if (tMaxX < tMaxZ) {
			cx += stepX;
			tMaxX += tDeltaX;
		} else {
			cz += stepZ;
			tMaxZ += tDeltaZ;
		}
	}
	return best <= maxT ? best : Infinity;
}

/**
 * Where a ray first meets an upright cylinder (centre `cx`, `cz`, from `y0` to `y1`, radius `r`),
 * as `t >= 0`, or `Infinity`.
 */
export function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, y0, y1, r) {
	let t0 = -Infinity;
	let t1 = Infinity;
	const px = ox - cx;
	const pz = oz - cz;
	const a = dx * dx + dz * dz;
	const c = px * px + pz * pz - r * r;
	if (a === 0) {
		if (c > 0) return Infinity;
	} else {
		const b = px * dx + pz * dz;
		const disc = b * b - a * c;
		if (disc < 0) return Infinity;
		const root = Math.sqrt(disc);
		t0 = (-b - root) / a;
		t1 = (-b + root) / a;
	}
	if (dy === 0) {
		if (oy < y0 || oy > y1) return Infinity;
	} else {
		let a0 = (y0 - oy) / dy;
		let a1 = (y1 - oy) / dy;
		if (a0 > a1) [a0, a1] = [a1, a0];
		t0 = Math.max(t0, a0);
		t1 = Math.min(t1, a1);
	}
	if (t0 > t1 || t1 < 0) return Infinity;
	return Math.max(0, t0);
}

/** The distance from a point to an upright cylinder (0 inside). */
function pointCylinder(px, py, pz, cx, cz, y0, y1, r) {
	const dx = px - cx;
	const dz = pz - cz;
	const flat = Math.max(0, Math.sqrt(dx * dx + dz * dz) - r);
	const up = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
	return Math.sqrt(flat * flat + up * up);
}

/**
 * The melee sector test: a target whose upright span is within `heightBand` of the attacker's, and
 * whose centre on the plane is within `reach` (plus its radius) and inside the arc — the dot
 * product of the facing (`fx`, `fz`, a unit vector) with the direction to it at least `cosHalf`. A
 * target standing on the attacker passes. Returns its plane distance, or `Infinity`.
 */
export function meleeSector(
	ax,
	ay,
	az,
	fx,
	fz,
	tx,
	ty,
	tz,
	{ reach, heightBand, cosHalf, radius },
) {
	if (Math.abs(ty - ay) > heightBand) return Infinity;
	const dx = tx - ax;
	const dz = tz - az;
	const d = Math.sqrt(dx * dx + dz * dz);
	if (d > reach + radius) return Infinity;
	if (d > 1e-9 && (dx * fx + dz * fz) / d < cosHalf) return Infinity;
	return d;
}

// --- the module -------------------------------------------------------------------------------

const pieceSpec = (rules, radius, height) =>
	Object.freeze({
		radius,
		height,
		speed: 0,
		sprint: 1,
		groundAccel: rules.pieceFriction,
		airAccel: 0,
		gravity: -9.81,
		maxFall: 30,
		jumpHeight: 0,
		doubleJumpHeight: 0,
		apexWindow: 0,
		coyoteSteps: 0,
		bufferSteps: 0,
		stepUp: 0,
		snapDown: 0.05,
		subMove: 0.1,
	});

const RESTING_INPUT = Object.freeze({ mx: 0, mz: 0, yaw: 0, buttons: 0 });

/**
 * One room's Crash rules. `world` is the room's `World3d`, `level` its built level, `rules` from
 * {@link crashRulesOf}, `tickHz` the room's step rate. The room calls {@link CrashRules.joined} and
 * {@link CrashRules.left} as players come and go, {@link CrashRules.holds} before stepping a
 * player, {@link CrashRules.applied} after each input it applies (with the step's result, during
 * the step that will be `stamp`), and {@link CrashRules.afterStep} once a step; events are taken
 * from {@link CrashRules.take}.
 */
export function createCrashRules({ level, rules, tickHz }) {
	const steps = (seconds) => Math.round(seconds * tickHz);
	const rewind = Math.max(1, Math.floor((REWIND_MS * tickHz) / 1000));
	const dt = 1 / tickHz;
	const piece = pieceSpec(rules, PIECE_RADIUS, PIECE_HEIGHT);
	const corpseSpec = pieceSpec(rules, CORPSE_RADIUS, CORPSE_HEIGHT);
	const weapons = Object.fromEntries(
		Object.entries(rules.weapons).map(([id, w]) => [
			id,
			{
				...w,
				id,
				cooldown: Math.max(1, steps(w.fireRate)),
				cosHalf: Math.cos(((w.arc / 2) * Math.PI) / 180),
			},
		]),
	);
	const pitZones = level.zones.filter((z) => z.kind === 'pit');

	const events = [];
	const emit = (event) => events.push(event);
	/** Entity id → entity; insertion order is the order they are stepped and synced. */
	const entities = new Map();
	/** Player id → the rules' own notes on it. */
	const notes = new Map();
	/** Player id → its recent places, a ring by stamp. */
	const history = new Map();
	let made = 0;
	let phase = 'waiting';
	let round = 0;
	let endsAt = 0;
	let winner = '';
	let pitLevel = 0;
	const scores = [0, 0];
	/** Piece spawn index → the stamp it comes back at. */
	const pieceReturns = new Map();

	const noteOf = (player) => {
		let note = notes.get(player.id);
		if (!note)
			notes.set(
				player.id,
				(note = {
					buttons: 0,
					readyAt: 0,
					respawnAt: 0,
					graceUntil: 0,
					corpse: '',
				}),
			);
		return note;
	};
	const heroOf = (player) => rules.heroes[player.character.id] ?? rules.heroes[rules.defaultHero];

	const arm = (player) => {
		const hero = heroOf(player);
		player.hero = Object.hasOwn(rules.heroes, player.character.id)
			? player.character.id
			: rules.defaultHero;
		player.weapon = hero.startingWeapons[0];
		player.hp = hero.maxHealth;
		player.shield = hero.maxShields;
	};

	const newEntity = (fields) => {
		if (entities.size >= MAX_ENTITIES) return undefined;
		const id = `e${++made}`;
		const entity = {
			id,
			kind: fields.kind,
			body: createBody3d({ x: fields.x, y: fields.y, z: fields.z }),
			state: ENTITY_STATE.resting,
			carriedBy: '',
			lastCarrier: '',
			lastTeam: -1,
			owner: fields.owner ?? '',
			spawn: fields.spawn ?? -1,
			score: fields.score ?? 0,
			asleep: false,
			team: fields.team ?? -1,
			weapon: fields.weapon ?? '',
			life: fields.life ?? 0,
		};
		if (fields.vx !== undefined) {
			entity.body.vx = fields.vx;
			entity.body.vy = fields.vy;
			entity.body.vz = fields.vz;
		}
		entities.set(id, entity);
		return entity;
	};

	const spawnPiece = (index) => {
		const at = rules.pieces[index];
		newEntity({ kind: 'piece', x: at.x, y: at.y, z: at.z, spawn: index, score: at.score });
	};

	const remove = (entity) => {
		entities.delete(entity.id);
	};

	const placeAt = (player, stamp) => {
		const ring = history.get(player.id);
		const slot = stamp % (rewind + 1);
		if (ring && ring.stamps[slot] === stamp)
			return { x: ring.xs[slot], y: ring.ys[slot], z: ring.zs[slot] };
		return { x: player.body.x, y: player.body.y, z: player.body.z };
	};

	const live = (player) => player.connected && player.status === STATUS3D.free;

	const drop = (player, speed) => {
		if (!player.carrying) return;
		const entity = entities.get(player.carrying);
		player.carrying = '';
		if (!entity) return;
		const f = aimDirection(player.body.yaw, 0);
		entity.carriedBy = '';
		entity.state = ENTITY_STATE.flying;
		entity.asleep = false;
		entity.body.vx = f.x * speed;
		entity.body.vy = 0;
		entity.body.vz = f.z * speed;
		entity.body.grounded = false;
		emit({ type: 'dropped', id: player.id, entity: entity.id });
	};

	const respawnPlayer = (player, stamp) => {
		Object.assign(player.body, createBody3d(player.home));
		player.status = STATUS3D.free;
		arm(player);
		const note = noteOf(player);
		note.respawnAt = 0;
		note.corpse = '';
		note.graceUntil = stamp + steps(rules.spawnGraceSeconds);
		history.delete(player.id);
		emit({ type: 'respawn', id: player.id });
	};

	const kill = (player, by, cause, stamp) => {
		if (player.status === STATUS3D.dead) return;
		drop(player, 1);
		player.status = STATUS3D.dead;
		player.hp = 0;
		const note = noteOf(player);
		const killer = by && by !== player.id ? by : '';
		emit({ type: 'kill', by: killer, target: player.id, cause });
		const killerPlayer = killer ? playersRef.get(killer) : undefined;
		if (killerPlayer && phase === 'running') {
			const points = rules.killScore[killerPlayer.team] ?? 0;
			if (points) scores[killerPlayer.team] += points;
		}
		if (cause !== 'fall' && cause !== 'void' && rules.corpseTeams.includes(player.team)) {
			const corpse = newEntity({
				kind: 'corpse',
				x: player.body.x,
				y: player.body.y,
				z: player.body.z,
				owner: player.id,
				score: 1,
			});
			if (corpse) {
				note.corpse = corpse.id;
				corpse.life = steps(rules.corpseSeconds);
				emit({ type: 'corpse', entity: corpse.id, owner: player.id });
				return;
			}
		}
		note.respawnAt = stamp + steps(rules.respawnSeconds);
	};

	const hurt = (target, amount, by, stamp) => {
		if (!live(target) || amount <= 0) return false;
		if (stamp < noteOf(target).graceUntil) return false;
		const soaked = Math.min(target.shield, amount);
		target.shield -= soaked;
		target.hp = Math.max(0, target.hp - (amount - soaked));
		emit({
			type: 'hit',
			by,
			target: target.id,
			damage: amount,
			hp: target.hp,
			shield: target.shield,
		});
		if (target.hp <= 0) kill(target, by, 'weapon', stamp);
		return true;
	};

	/** A push on a player's velocity after its last applied input, told to its device. */
	const knock = (target, x, z, force, lift) => {
		if (!live(target) || force <= 0) return;
		const d = Math.sqrt(x * x + z * z);
		if (d === 0) return;
		const vx = (x / d) * force;
		const vz = (z / d) * force;
		const vy = force * lift;
		target.body.vx += vx;
		target.body.vy = Math.max(target.body.vy, 0) + vy;
		target.body.vz += vz;
		target.body.grounded = false;
		emit({ type: 'knockback', id: target.id, seq: target.ack, vx, vy, vz });
	};

	const foes = (player, every) =>
		every.filter((p) => p !== player && live(p) && (rules.friendlyFire || p.team !== player.team));

	const attack = (player, weapon, input, every, stamp) => {
		const seen = Math.max(stamp - 1 - rewind, Math.min(stamp - 1, input.view));
		const { x, y, z } = player.body;
		emit({ type: 'attack', id: player.id, weapon: weapon.id });
		if (weapon.type === 'melee') {
			const f = aimDirection(input.yaw, 0);
			let best;
			let bestD = Infinity;
			for (const target of foes(player, every)) {
				const at = placeAt(target, seen);
				const d = meleeSector(x, y, z, f.x, f.z, at.x, at.y, at.z, {
					reach: weapon.range,
					heightBand: weapon.heightBand,
					cosHalf: weapon.cosHalf,
					radius: target.spec.radius,
				});
				if (d < bestD) {
					bestD = d;
					best = target;
				}
			}
			if (best && hurt(best, weapon.damage, player.id, stamp))
				knock(best, f.x, f.z, weapon.hitForce, weapon.knockUp);
			return;
		}
		const dir = aimDirection(input.yaw, input.pitch);
		const ey = y + rules.eyeHeight;
		if (weapon.type === 'hitscan') {
			const wall = rayLevel3d(level, x, ey, z, dir.x, dir.y, dir.z, weapon.range);
			let best;
			let bestT = Math.min(wall, weapon.range);
			for (const target of foes(player, every)) {
				const at = placeAt(target, seen);
				const t = rayCylinder(
					x,
					ey,
					z,
					dir.x,
					dir.y,
					dir.z,
					at.x,
					at.z,
					at.y,
					at.y + target.spec.height,
					target.spec.radius,
				);
				if (t < bestT) {
					bestT = t;
					best = target;
				}
			}
			emit({
				type: 'shot',
				id: player.id,
				x: x + dir.x * bestT,
				y: ey + dir.y * bestT,
				z: z + dir.z * bestT,
				target: best?.id ?? '',
			});
			if (best && hurt(best, weapon.damage, player.id, stamp))
				knock(best, dir.x, dir.z, weapon.hitForce, weapon.knockUp);
			return;
		}
		const ahead = player.spec.radius + weapon.projectileRadius + 0.05;
		const shot = newEntity({
			kind: 'projectile',
			x: x + dir.x * ahead,
			y: ey + dir.y * ahead,
			z: z + dir.z * ahead,
			vx: dir.x * weapon.projectileSpeed,
			vy: dir.y * weapon.projectileSpeed,
			vz: dir.z * weapon.projectileSpeed,
			owner: player.id,
			team: player.team,
			weapon: weapon.id,
			life: Math.max(1, steps(weapon.range / weapon.projectileSpeed)),
		});
		if (shot) shot.state = ENTITY_STATE.flying;
	};

	const interact = (player) => {
		if (player.carrying) {
			const entity = entities.get(player.carrying);
			player.carrying = '';
			if (!entity) return;
			const dir = noteOf(player).aim;
			entity.carriedBy = '';
			entity.state = ENTITY_STATE.flying;
			entity.asleep = false;
			entity.body.vx = dir.x * rules.throwSpeed;
			entity.body.vy = dir.y * rules.throwSpeed + rules.throwLift;
			entity.body.vz = dir.z * rules.throwSpeed;
			entity.body.grounded = false;
			emit({ type: 'thrown', id: player.id, entity: entity.id });
			return;
		}
		const mid = player.body.y + player.spec.height / 2;
		let best;
		let bestD = Infinity;
		for (const entity of entities.values()) {
			if (!CARRIABLE.includes(entity.kind) || entity.carriedBy) continue;
			if (entity.owner === player.id) continue;
			const dx = entity.body.x - player.body.x;
			const dz = entity.body.z - player.body.z;
			const d = Math.sqrt(dx * dx + dz * dz);
			if (d > rules.interactRange || Math.abs(entity.body.y - mid) > rules.interactHeight) continue;
			if (d < bestD) {
				bestD = d;
				best = entity;
			}
		}
		if (!best) return;
		best.carriedBy = player.id;
		best.lastCarrier = player.id;
		best.lastTeam = player.team;
		best.state = ENTITY_STATE.carried;
		best.asleep = false;
		player.carrying = best.id;
		emit({ type: 'picked', id: player.id, entity: best.id });
	};

	/** Score a carriable in the pit for its last carrier's team. */
	const score = (entity, stamp) => {
		const team = entity.lastTeam;
		const points = team >= 0 && phase === 'running' ? entity.score : 0;
		if (points) scores[team] += points;
		emit({
			type: 'pieceScored',
			entity: entity.id,
			kind: entity.kind,
			by: entity.lastCarrier,
			team: team >= 0 ? TEAMS[team] : '',
			points,
			red: scores[0],
			blue: scores[1],
		});
		if (points) {
			const next = Math.min(rules.pitMax, pitLevel + rules.pitRise);
			if (next !== pitLevel) {
				pitLevel = next;
				emit({ type: 'pitRise', level: pitLevel });
			}
		}
		remove(entity);
		if (entity.kind === 'corpse') {
			const owner = playersRef.get(entity.owner);
			if (owner) {
				noteOf(owner).corpse = '';
				noteOf(owner).respawnAt = stamp + steps(rules.corpseScoredSeconds);
			}
		} else if (entity.spawn >= 0)
			pieceReturns.set(entity.spawn, stamp + steps(rules.pieceRespawnSeconds));
	};

	const inPit = (entity, spec) =>
		pitZones.length > 0 &&
		zonesAt3d(entity.body, level, spec).some((id) => level.zones[id].kind === 'pit');

	const stepCarriable = (entity, stamp) => {
		const spec = entity.kind === 'corpse' ? corpseSpec : piece;
		if (entity.carriedBy) {
			const carrier = playersRef.get(entity.carriedBy);
			if (!carrier) {
				entity.carriedBy = '';
				entity.state = ENTITY_STATE.flying;
			} else if (!carrier.connected || carrier.silent > steps(rules.carryStallSeconds)) {
				drop(carrier, 0);
			} else {
				const f = aimDirection(carrier.body.yaw, 0);
				entity.body.x = carrier.body.x + f.x * rules.carryAhead;
				entity.body.y = carrier.body.y + rules.carryHeight;
				entity.body.z = carrier.body.z + f.z * rules.carryAhead;
				entity.body.vx = carrier.body.vx;
				entity.body.vy = carrier.body.vy;
				entity.body.vz = carrier.body.vz;
				return;
			}
		}
		if (!entity.asleep) {
			const vx = entity.body.vx;
			const vy = entity.body.vy;
			const vz = entity.body.vz;
			const result = stepBody3d(entity.body, RESTING_INPUT, level, spec, dt);
			if (result.onWall) {
				if (entity.body.vx === 0 && vx !== 0) entity.body.vx = -vx * rules.pieceBounce;
				if (entity.body.vz === 0 && vz !== 0) entity.body.vz = -vz * rules.pieceBounce;
			}
			if (result.landed && !result.bounced && -vy * rules.pieceBounce > SETTLE_SPEED) {
				entity.body.vy = -vy * rules.pieceBounce;
				entity.body.grounded = false;
			}
			if (entity.body.grounded) {
				entity.state = ENTITY_STATE.resting;
				if (Math.abs(entity.body.vx) < SLEEP_SPEED && Math.abs(entity.body.vz) < SLEEP_SPEED) {
					entity.body.vx = 0;
					entity.body.vz = 0;
					entity.asleep = true;
				}
			}
			if (
				result.fell ||
				zonesAt3d(entity.body, level, spec).some((id) => level.zones[id].kind === 'void')
			) {
				if (inPit(entity, spec)) return score(entity, stamp);
				if (entity.kind === 'corpse') {
					remove(entity);
					const owner = playersRef.get(entity.owner);
					if (owner) {
						noteOf(owner).corpse = '';
						noteOf(owner).respawnAt = stamp;
					}
				} else if (entity.spawn >= 0) {
					const at = rules.pieces[entity.spawn];
					Object.assign(entity.body, createBody3d(at));
					entity.state = ENTITY_STATE.resting;
					entity.lastCarrier = '';
					entity.lastTeam = -1;
				} else remove(entity);
				return;
			}
		}
		if (inPit(entity, spec)) score(entity, stamp);
	};

	const stepProjectile = (entity, every, stamp) => {
		const weapon = weapons[entity.weapon];
		const b = entity.body;
		b.vy += weapon.projectileGravity * dt;
		const dx = b.vx * dt;
		const dy = b.vy * dt;
		const dz = b.vz * dt;
		const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (len === 0) return remove(entity);
		const ux = dx / len;
		const uy = dy / len;
		const uz = dz / len;
		const wall = rayLevel3d(level, b.x, b.y, b.z, ux, uy, uz, len);
		let hitT = wall;
		let target;
		const r = weapon.projectileRadius;
		for (const p of every) {
			if (p.id === entity.owner || !live(p)) continue;
			if (!rules.friendlyFire && p.team === entity.team) continue;
			const t = rayCylinder(
				b.x,
				b.y,
				b.z,
				ux,
				uy,
				uz,
				p.body.x,
				p.body.z,
				p.body.y - r,
				p.body.y + p.spec.height + r,
				p.spec.radius + r,
			);
			if (t <= len && t < hitT) {
				hitT = t;
				target = p;
			}
		}
		if (hitT === Infinity) {
			b.x += dx;
			b.y += dy;
			b.z += dz;
			entity.life -= 1;
			if (entity.life <= 0 || b.y < level.killY) remove(entity);
			return;
		}
		const ix = b.x + ux * hitT;
		const iy = b.y + uy * hitT;
		const iz = b.z + uz * hitT;
		remove(entity);
		emit({ type: 'impact', entity: entity.id, x: ix, y: iy, z: iz, target: target?.id ?? '' });
		const hits = new Set();
		if (target) hits.add(target);
		if (weapon.splashRadius > 0)
			for (const p of every) {
				if (p.id === entity.owner || hits.has(p) || !live(p)) continue;
				if (!rules.friendlyFire && p.team === entity.team) continue;
				const d = pointCylinder(
					ix,
					iy,
					iz,
					p.body.x,
					p.body.z,
					p.body.y,
					p.body.y + p.spec.height,
					p.spec.radius,
				);
				if (d <= weapon.splashRadius) hits.add(p);
			}
		for (const p of hits) {
			const px = p.body.x - ix;
			const pz = p.body.z - iz;
			const push = p === target || (px === 0 && pz === 0) ? [ux, uz] : [px, pz];
			if (hurt(p, weapon.damage, entity.owner, stamp))
				knock(p, push[0], push[1], weapon.hitForce, weapon.knockUp);
		}
	};

	/** Every player at its home with full health, the pieces at their spawns, the pit drained. */
	const startRound = (every, stamp) => {
		phase = 'running';
		round += 1;
		winner = '';
		endsAt = stamp + steps(rules.roundSeconds);
		scores[0] = 0;
		scores[1] = 0;
		pitLevel = 0;
		entities.clear();
		pieceReturns.clear();
		for (let i = 0; i < rules.pieces.length; i++) spawnPiece(i);
		for (const player of every) {
			player.carrying = '';
			respawnPlayer(player, stamp);
			noteOf(player).readyAt = 0;
		}
		emit({ type: 'roundStart', round });
	};

	const endRound = (stamp) => {
		phase = 'ended';
		winner = scores[0] > scores[1] ? TEAMS[0] : scores[1] > scores[0] ? TEAMS[1] : '';
		endsAt = stamp + steps(rules.nextRoundSeconds);
		for (const entity of entities.values()) if (entity.kind === 'projectile') remove(entity);
		emit({ type: 'roundEnd', round, winner, red: scores[0], blue: scores[1] });
	};

	/** The room's players by id, set by the room. */
	let playersRef = new Map();

	return {
		get phase() {
			return phase;
		},
		get round() {
			return round;
		},
		get endsAt() {
			return endsAt;
		},
		get winner() {
			return winner;
		},
		get scores() {
			return scores;
		},
		get pitLevel() {
			return pitLevel;
		},
		/** Entity id → entity (`kind`, `body`, `state`, `carriedBy`, `owner`, …). */
		entities,
		/** The room's players (a `Map` by id the room keeps). */
		bind(players) {
			playersRef = players;
		},
		/** Whether the rules hold a player still: its inputs are taken but do not step it. */
		holds: (player) => player.status !== STATUS3D.free,
		/** A player the room just let in, at the step that will be `stamp`. */
		joined(player, every, people, stamp) {
			player.carrying = '';
			player.status = STATUS3D.free;
			arm(player);
			noteOf(player).graceUntil = stamp + steps(rules.spawnGraceSeconds);
			if (phase === 'waiting' && people > 0) startRound(every, stamp);
		},
		left(id) {
			const note = notes.get(id);
			const player = playersRef.get(id);
			if (player) drop(player, 0);
			if (note?.corpse) entities.delete(note.corpse);
			for (const entity of entities.values()) {
				if (entity.carriedBy === id) {
					entity.carriedBy = '';
					entity.state = ENTITY_STATE.flying;
				}
				if (entity.kind === 'projectile' && entity.owner === id) entities.delete(entity.id);
			}
			notes.delete(id);
			history.delete(id);
		},
		/** No person is left: the room waits, and the next person starts a new round. */
		empty() {
			phase = 'waiting';
			endsAt = 0;
			winner = '';
		},
		/**
		 * After the room applied `input` for `player` (stepped or held), `result` the step's result
		 * (none while held). A `rest` step is the room's own for a player that sent nothing (silent
		 * or dropped): it can fall, but it presses, aims and holds nothing. Returns whether the rules
		 * took the step's fall (the room then does not put the player home).
		 */
		applied(player, input, result, every, stamp, rest = false) {
			const note = noteOf(player);
			const pressed = rest ? 0 : input.buttons & ~note.buttons;
			if (!rest) {
				note.buttons = input.buttons;
				note.aim = aimDirection(input.yaw, input.pitch);
			}
			if (player.status !== STATUS3D.free) return false;
			if (
				result?.fell ||
				(result &&
					zonesAt3d(player.body, level, player.spec).some((id) => level.zones[id].kind === 'void'))
			) {
				kill(player, '', result.fell ? 'fall' : 'void', stamp);
				return true;
			}
			if (rest || phase !== 'running') return false;
			if (pressed & 16) interact(player);
			const weapon = weapons[player.weapon];
			if (weapon && stamp >= note.readyAt) {
				const fire = weapon.automatic ? input.buttons & 4 : pressed & 4;
				if (fire && !player.carrying) {
					note.readyAt = stamp + weapon.cooldown;
					attack(player, weapon, input, every, stamp);
				}
			}
			return false;
		},
		/** Once a step, after every player moved: the step is now `stamp`. */
		afterStep(every, stamp) {
			if (phase === 'running' || phase === 'ended') {
				for (const entity of [...entities.values()]) {
					if (!entities.has(entity.id)) continue;
					if (entity.kind === 'projectile') stepProjectile(entity, every, stamp);
					else stepCarriable(entity, stamp);
				}
				for (const entity of [...entities.values()]) {
					if (entity.kind !== 'corpse' || entity.carriedBy) continue;
					entity.life -= 1;
					if (entity.life <= 0) {
						remove(entity);
						const owner = playersRef.get(entity.owner);
						if (owner) {
							noteOf(owner).corpse = '';
							noteOf(owner).respawnAt = stamp;
						}
					}
				}
				for (const [index, at] of [...pieceReturns]) {
					if (stamp < at) continue;
					pieceReturns.delete(index);
					spawnPiece(index);
				}
				for (const player of every) {
					if (player.status !== STATUS3D.dead) continue;
					const note = noteOf(player);
					if (note.respawnAt && stamp >= note.respawnAt) respawnPlayer(player, stamp);
				}
			}
			if (phase === 'running' && stamp >= endsAt) endRound(stamp);
			else if (phase === 'ended' && stamp >= endsAt) startRound(every, stamp);
			for (const player of every) {
				let ring = history.get(player.id);
				if (!ring) {
					const size = rewind + 1;
					ring = {
						stamps: new Float64Array(size).fill(-1),
						xs: new Float64Array(size),
						ys: new Float64Array(size),
						zs: new Float64Array(size),
					};
					history.set(player.id, ring);
				}
				const slot = stamp % (rewind + 1);
				ring.stamps[slot] = stamp;
				ring.xs[slot] = player.body.x;
				ring.ys[slot] = player.body.y;
				ring.zs[slot] = player.body.z;
			}
		},
		/** The events since the last take, in order. */
		take: () => events.splice(0),
	};
}

/** The 3D rules modules a room can run (`arcade.world3d.rules.module`). */
export const ONLINE_RULES3D_MODULES = Object.freeze({ crash: { create: createCrashRules } });
