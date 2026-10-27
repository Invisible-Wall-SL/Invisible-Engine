/**
 * The rules of an online room (`docs/design/realtime-multiplayer.md` §4, §6, §8; game-families §9
 * #18; P10.15): what decides the game — who was hit, who scored, when a round ends — run on the
 * game server, as the game config's data (`arcade.online.rules`), with a named rules module
 * ({@link ONLINE_RULES_MODULES}) for what the data cannot say. A device runs none of it: it draws
 * what the room reports, and predicts only its own player's movement (`netcode.js`).
 *
 * Plain, dependency-free ESM beside `online.js`, so `scripts/check-online-rules.mjs` runs exactly
 * what a room runs.
 *
 * THE DATA. Zones are currents (moved into `online.js` `stepPlayer`, where the device predicts
 * them) or the goal: the first player into a goal wins the round. An ability is a button of a
 * character that, off cooldown, hits every player of its target characters within `reach`, tested
 * where the user's device was drawing them (`view`, held to {@link REWIND_MS} behind the room), so
 * a hit that lands on the screen lands in the room. Its effect is `stun` (the target stands still)
 * or `catch` (the target is out, then respawns), and it may score. A player whose status ends, who
 * respawns or who starts a round cannot be hit for {@link GRACE_MS}, and a respawn forgets the
 * player's past places, so nobody is hit where it no longer was. A round ends at the goal or on its
 * clock; the next starts `nextRoundSeconds` later with everyone back at the spawn and every score
 * at 0. Players move in every phase, so a device's prediction holds through the pause.
 *
 * Steps are counted as the room counts them: `stamp` is the room step a state is stamped with
 * (`steps` after the step that made it), and every time is a whole number of steps. Within one
 * step, players act in the order they joined.
 */

import { BUTTONS, clipToField, levelCell } from './online.js';
import { aabbOf, createStaticIndex, inZone, queryStatic, touching } from './motion.js';

/** A player's status: free, held still by a stun, or out until it respawns. */
export const STATUS = Object.freeze({ free: 0, stunned: 1, out: 2 });

/** How far back an ability is tested against what its user saw, at most, ms (§6: lag
 *  compensation). Whole steps, rounded down. */
export const REWIND_MS = 250;

/** How long a player cannot be hit after a status ends, a respawn or a round's start, ms. */
export const GRACE_MS = 1000;

/** The message type every room event travels as (`services/game-server` broadcasts each step's
 *  events as one array of it; `apps/lines` `game/online.ts` reads it). */
export const ONLINE_EVENT = 'event';

/** A running score stays well inside the wire's int32, however long a round lasts. */
const SCORE_LIMIT = 1e9;

/** Add `points` to a player's score, held to ±{@link SCORE_LIMIT}. */
const score = (player, points) => {
	player.score = Math.max(-SCORE_LIMIT, Math.min(SCORE_LIMIT, player.score + points));
};

const stepsOf = (ms, tickHz) => Math.max(0, Math.round((ms * tickHz) / 1000));

/**
 * `tag`: one player is "it" (`mark`); touching another free player passes it on (the new one cannot
 * pass it back for a second), and every second each player who is not it scores 1.
 */
const tag = {
	step(world) {
		const live = world.players.filter((p) => p.connected && p.status === STATUS.free);
		let it = world.players.find((p) => p.mark);
		if (!it || !it.connected) {
			if (it) it.mark = false;
			it = live[0];
			if (!it) return;
			it.mark = true;
			it.memo.tagFrom = world.stamp + world.tickHz;
		}
		if (it.status === STATUS.free && world.stamp >= (it.memo.tagFrom ?? 0)) {
			const caught = live.find((p) => p !== it && touching(it.body, p.body));
			if (caught) {
				it.mark = false;
				caught.mark = true;
				caught.memo.tagFrom = world.stamp + world.tickHz;
				world.emit({ type: 'hit', by: it.id, target: caught.id, effect: 'tag' });
			}
		}
		if (world.stamp % world.tickHz === 0) {
			for (const p of world.players) if (p.connected && !p.mark) score(p, 1);
		}
	},
};

/** The named rules modules (`arcade.online.rules.module`): code for what the data cannot say. Each
 *  has a `step(world)` run once a step while a round runs. `game-config` lists the same ids. */
export const ONLINE_RULES_MODULES = Object.freeze({ tag });

/**
 * The rules of one room. `game` is the room's `OnlineGame`; `spawn(player)` puts a player back at
 * the start (the room owns where that is). The room calls {@link OnlineRules.applied} after each
 * input it applies and {@link OnlineRules.afterStep} once a step; both may push events.
 */
export function createOnlineRules(game, { spawn }) {
	const { online } = game;
	const { rules, tickHz } = online;
	const rewind = Math.max(1, Math.floor((REWIND_MS * tickHz) / 1000));
	const grace = stepsOf(GRACE_MS, tickHz);
	const goals = createStaticIndex(
		rules.zones
			.filter((rule) => rule.goal)
			.map((rule) => {
				const zone = game.zones.find((z) => z.id === rule.zone);
				const clipped = zone && clipToField(zone, game.field);
				return clipped && { ...clipped, characters: rule.characters };
			})
			.filter(Boolean),
		levelCell(game.field),
	);
	const abilities = rules.abilities.map((a, i) => ({
		...a,
		key: String(i),
		bit: BUTTONS[a.button],
		cooldown: Math.max(1, stepsOf(a.cooldownMs, tickHz)),
		hold: stepsOf(a.ms, tickHz),
	}));
	const module = rules.module ? ONLINE_RULES_MODULES[rules.module] : undefined;
	/** id → past places, a ring by stamp. */
	const history = new Map();
	const events = [];
	let phase = 'waiting';
	let round = 0;
	let endsAt = 0;
	let winner = '';

	const emit = (event) => events.push(event);

	const placeAt = (player, stamp) => {
		const ring = history.get(player.id);
		const slot = stamp % (rewind + 1);
		if (ring && ring.stamps[slot] === stamp) return { x: ring.xs[slot], y: ring.ys[slot] };
		return { x: player.body.x, y: player.body.y };
	};

	const free = (player, stamp) => {
		player.status = STATUS.free;
		player.until = 0;
		player.safeUntil = stamp + grace;
	};

	/** Back to the start: its past places are not where it is any more. */
	const respawn = (player) => {
		spawn(player);
		history.delete(player.id);
	};

	const startRound = (players, stamp) => {
		phase = 'running';
		round += 1;
		winner = '';
		endsAt = rules.round.seconds ? stamp + Math.round(rules.round.seconds * tickHz) : 0;
		for (const player of players) {
			player.score = 0;
			player.mark = false;
			player.memo = {};
			player.cooldowns = {};
			free(player, stamp);
			respawn(player);
		}
		emit({ type: 'roundStart', round });
	};

	const endRound = (stamp, by) => {
		phase = 'ended';
		winner = by ?? '';
		endsAt = stamp + Math.round(rules.round.nextRoundSeconds * tickHz);
		emit({ type: 'roundEnd', round, winner });
	};

	const leader = (players) => {
		let best;
		let tied = false;
		for (const p of players) {
			if (!best || p.score > best.score) {
				best = p;
				tied = false;
			} else if (p.score === best.score) tied = true;
		}
		return best && !tied ? best.id : '';
	};

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
		/** A player the room just let in: a new player's first join starts the first round. */
		joined(player, every, stamp) {
			player.score = 0;
			player.mark = false;
			player.memo = {};
			player.cooldowns = {};
			free(player, stamp);
			if (phase === 'waiting') startRound([...every], stamp);
			emit({ type: 'joined', id: player.id });
		},
		left(id) {
			history.delete(id);
			emit({ type: 'left', id });
		},
		/** Whether the room holds a player still (its inputs are taken but do not move it). */
		holds: (player) => player.status !== STATUS.free,
		/** After the room applied `input` for `player` during the step that will be `stamp`. */
		applied(player, input, every, stamp) {
			if (phase !== 'running' || player.status !== STATUS.free) return;
			let players;
			for (const ability of abilities) {
				if (ability.character !== player.character.id || !(input.buttons & ability.bit)) continue;
				if (stamp < (player.cooldowns[ability.key] ?? 0)) continue;
				player.cooldowns[ability.key] = stamp + ability.cooldown;
				emit({ type: 'ability', by: player.id, button: ability.button });
				players ??= [...every];
				const seen = Math.max(stamp - 1 - rewind, Math.min(stamp - 1, input.view));
				for (const target of players) {
					if (target === player || !target.connected || target.status !== STATUS.free) continue;
					if (stamp < target.safeUntil || !ability.targets.includes(target.character.id)) continue;
					const at = placeAt(target, seen);
					if (Math.hypot(at.x - player.body.x, at.y - player.body.y) > ability.reach) continue;
					target.status = ability.effect === 'catch' ? STATUS.out : STATUS.stunned;
					target.until = stamp + ability.hold;
					score(player, ability.score);
					emit({
						type: ability.effect === 'catch' ? 'caught' : 'hit',
						by: player.id,
						target: target.id,
						effect: ability.effect,
					});
				}
			}
		},
		/** Once a step, after every player moved: the step is now `stamp`. Returns its events. */
		afterStep(every, stamp) {
			const players = [...every];
			for (const player of players) {
				if (player.status === STATUS.free || stamp < player.until) continue;
				if (player.status === STATUS.out) respawn(player);
				free(player, stamp);
			}
			if (phase === 'running') {
				if (goals.shapes.length) {
					for (const player of players) {
						if (!player.connected || player.status !== STATUS.free) continue;
						const reached = queryStatic(goals, aabbOf(player.body)).some(
							(goal) =>
								(!goal.characters || goal.characters.includes(player.character.id)) &&
								inZone(player.body, goal),
						);
						if (!reached) continue;
						score(player, rules.round.goalScore);
						endRound(stamp, player.id);
						break;
					}
				}
				if (phase === 'running' && module) {
					module.step({ players, stamp, tickHz, emit });
				}
				if (phase === 'running' && endsAt && stamp >= endsAt) endRound(stamp, leader(players));
			} else if (phase === 'ended' && stamp >= endsAt) startRound(players, stamp);
			for (const player of players) {
				let ring = history.get(player.id);
				if (!ring) {
					const size = rewind + 1;
					ring = {
						stamps: new Float64Array(size).fill(-1),
						xs: new Float64Array(size),
						ys: new Float64Array(size),
					};
					history.set(player.id, ring);
				}
				const slot = stamp % (rewind + 1);
				ring.stamps[slot] = stamp;
				ring.xs[slot] = player.body.x;
				ring.ys[slot] = player.body.y;
			}
			return events.splice(0);
		},
		/** Events raised outside a step (a join, a leave), taken by the room. */
		take: () => events.splice(0),
	};
}
