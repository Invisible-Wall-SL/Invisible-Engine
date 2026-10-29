/**
 * Abilities and zone forces (`docs/design/game-families.md` §4.3; `realtime-multiplayer.md` §4;
 * P10.15, P11.5): the ONE implementation the offline arcade loop (`engine-game` `arcadeLoop.ts`)
 * and an online room (`onlineRules.js`, `online.js`) both call, so the two cannot disagree about a
 * hit, a cooldown or a push.
 *
 * AN ABILITY is a button of a character that, off its cooldown, hits every actor of its target
 * characters within `reach` of its user's centre: `stun` holds the target still, `catch` puts it
 * out until it is back (online it respawns), each for the ability's `ms`; `hook` hands the nearest
 * target to the caller (online, a rules module's line). An actor whose status ends cannot be hit
 * for {@link GRACE_MS}. Times are whole steps: `stamp` is the step that is running, counted from 1.
 *
 * An actor is `{ id, character: { id }, body, status, until, safeUntil, cooldowns }`, mutated in
 * place: an online room's player, or the offline loop's record of a character.
 *
 * A ZONE FORCE is a zone that adds a velocity to a body in it, while the body moves: a river's
 * current, wind. It is added for the move, not kept.
 *
 * Plain, dependency-free ESM beside `motion.js`.
 */

import { aabbOf, createStaticIndex, inZone, queryStatic } from './motion.js';

/** An actor's status: free, held still by a stun, or out until it is back; or held by a rules
 *  module until the module lets it go (P11.3): `grounded` on a sandbank (it can still be hit),
 *  `hooked` on a line. */
export const STATUS = Object.freeze({ free: 0, stunned: 1, out: 2, grounded: 3, hooked: 4 });

/** How long an actor cannot be hit after a status ends (and online, a respawn or a round's start),
 *  ms. */
export const GRACE_MS = 1000;

/** Whole steps in `ms` at `hz`. */
export const stepsOf = (ms, hz) => Math.max(0, Math.round((ms * hz) / 1000));

/** Resolved abilities (`game-config`) in steps at `hz`: `key` is the cooldown's name, `cooldown`
 *  and `hold` its cooldown and `ms`. */
export const abilitySpecs = (abilities, hz) =>
	abilities.map((a, i) => ({
		...a,
		key: String(i),
		cooldown: Math.max(1, stepsOf(a.cooldownMs, hz)),
		hold: stepsOf(a.ms, hz),
	}));

/** Whether an actor can be hit at all: free, or held by a sandbank. */
export const hittable = (actor) => actor.status === STATUS.free || actor.status === STATUS.grounded;

/** Free an actor, safe from hits for `grace` steps. */
export const freeActor = (actor, stamp, grace) => {
	actor.status = STATUS.free;
	actor.until = 0;
	actor.safeUntil = stamp + grace;
};

/**
 * The actors of `players` that `ability` of `user` reaches at `stamp`, nearest last-found order (the
 * players' order), each with its distance. `present(target)` says a target is in play (online: it
 * is connected); `placeOf(target)` where the user saw it.
 */
export function abilityTargets(user, ability, players, stamp, { present, placeOf }) {
	const found = [];
	for (const target of players) {
		if (target === user || !present(target) || !hittable(target)) continue;
		if (stamp < target.safeUntil || !ability.targets.includes(target.character.id)) continue;
		const at = placeOf(target);
		const d = Math.hypot(at.x - user.body.x, at.y - user.body.y);
		if (d <= ability.reach) found.push({ target, d });
	}
	return found;
}

/**
 * Use `user`'s abilities ({@link abilitySpecs}) at `stamp`: each of its character's that
 * `pressed(ability)` and is off cooldown starts its cooldown, calls `used(ability)` and acts on its
 * targets ({@link abilityTargets}, over `players()`, asked once): a `stun` or `catch` sets each
 * one's status and `until`, then `hit(target, ability)`; a `hook` calls `hook(nearest, ability,
 * players)` with the nearest (the first of equals).
 */
export function useAbilities(user, stamp, specs, ctx) {
	let players;
	for (const ability of specs) {
		if (ability.character !== user.character.id) continue;
		if (stamp < (user.cooldowns[ability.key] ?? 0) || !ctx.pressed(ability)) continue;
		user.cooldowns[ability.key] = stamp + ability.cooldown;
		ctx.used(ability);
		players ??= ctx.players();
		let nearest;
		let nearestAt = Infinity;
		for (const { target, d } of abilityTargets(user, ability, players, stamp, ctx)) {
			if (ability.effect === 'hook') {
				if (d < nearestAt) [nearest, nearestAt] = [target, d];
				continue;
			}
			target.status = ability.effect === 'catch' ? STATUS.out : STATUS.stunned;
			target.until = stamp + ability.hold;
			ctx.hit(target, ability);
		}
		if (nearest) ctx.hook(nearest, ability, players);
	}
}

/** End every stun and catch due at `stamp`: a caught actor is first put back (`back(actor)`), then
 *  each is freed with `grace` steps of safety. A module's statuses are the module's to end. */
export function endStatuses(actors, stamp, grace, back) {
	for (const actor of actors) {
		if (actor.status === STATUS.free || actor.status > STATUS.out) continue;
		if (stamp < actor.until) continue;
		if (actor.status === STATUS.out) back(actor);
		freeActor(actor, stamp, grace);
	}
}

/**
 * The zone forces of a level, indexed once: each rule (`{ zone, force, characters? }`) with a force
 * whose zone is in `zones`. With `character`, only the rules that apply to it (every one when a rule
 * names none) and none keeps its list; without, each keeps its `characters` for
 * {@link addZoneForces} to read. `clip(zone)` may hold a zone to the field (`undefined`: drop it).
 */
export function zoneForces(zones, rules, { character, clip = (zone) => zone, cell } = {}) {
	const byId = new Map((zones ?? []).map((zone) => [zone.id, zone]));
	const forces = [];
	for (const rule of rules ?? []) {
		const zone = byId.get(rule.zone);
		if (!zone || !rule.force) continue;
		if (character !== undefined && rule.characters && !rule.characters.includes(character))
			continue;
		const clipped = clip(zone);
		if (!clipped) continue;
		const { id, x, y, w, h } = clipped;
		const force = { id, x, y, w, h, fx: rule.force.x, fy: rule.force.y };
		if (character === undefined && rule.characters) force.characters = rule.characters;
		forces.push(force);
	}
	return createStaticIndex(forces, cell);
}

/** Add to `body`'s velocity the force of every zone of `forces` it is in, in the level's order; a
 *  zone that names characters pushes only a body of one of them (`character`). */
export function addZoneForces(body, forces, character) {
	for (const zone of queryStatic(forces, aabbOf(body))) {
		if (zone.characters && !zone.characters.includes(character)) continue;
		if (!inZone(body, zone)) continue;
		body.vx += zone.fx;
		body.vy += zone.fy;
	}
}
