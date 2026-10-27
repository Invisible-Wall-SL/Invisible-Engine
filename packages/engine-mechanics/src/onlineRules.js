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
 * or `catch` (the target is out, then respawns), and it may score. A round ends at the goal or on
 * its clock; the next starts `nextRoundSeconds` later with everyone back at the spawn and every
 * score at 0. Players move in every phase, so a device's prediction holds through the pause.
 *
 * Steps are counted as the room counts them: `stamp` is the room step a state is stamped with
 * (`steps` after the step that made it), and every time is a whole number of steps.
 */

import { BUTTONS } from './online.js';
import { aabbOf, createStaticIndex, inZone, queryStatic, touching } from './motion.js';

/** A player's status: free, held still by a stun, or out until it respawns. */
export const STATUS = Object.freeze({ free: 0, stunned: 1, out: 2 });

/** How far back an ability is tested against what its user saw, ms (§6: lag compensation). */
export const REWIND_MS = 250;

/** The phases of a room: before anyone joins, a round, the pause after one. */
export const PHASES = Object.freeze(['waiting', 'running', 'ended']);

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
		if (world.stamp >= (it.memo.tagFrom ?? 0)) {
			const caught = live.find((p) => p !== it && touching(it.body, p.body));
			if (caught) {
				it.mark = false;
				caught.mark = true;
				caught.memo.tagFrom = world.stamp + world.tickHz;
				world.emit({ type: 'hit', by: it.id, target: caught.id, effect: 'tag' });
			}
		}
		if (world.stamp % world.tickHz === 0) {
			for (const p of world.players) if (p.connected && !p.mark) p.score += 1;
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
	const rewind = Math.max(1, stepsOf(REWIND_MS, tickHz));
	const goals = createStaticIndex(
		rules.zones
			.filter((rule) => rule.goal)
			.map((rule) => {
				const zone = game.zones.find((z) => z.id === rule.zone);
				return zone && { ...zone, characters: rule.characters };
			})
			.filter(Boolean),
	);
	const abilities = rules.abilities.map((a) => ({
		...a,
		bit: BUTTONS[a.button],
		cooldown: stepsOf(a.cooldownMs, tickHz),
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

	const free = (player) => {
		player.status = STATUS.free;
		player.until = 0;
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
			free(player);
			spawn(player);
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
			free(player);
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
		applied(player, input, players, stamp) {
			if (phase !== 'running' || player.status !== STATUS.free) return;
			for (const ability of abilities) {
				if (ability.character !== player.character.id || !(input.buttons & ability.bit)) continue;
				const key = ability.button;
				if (stamp < (player.cooldowns[key] ?? 0)) continue;
				player.cooldowns[key] = stamp + ability.cooldown;
				emit({ type: 'ability', by: player.id, button: key });
				const seen = Math.max(stamp - 1 - rewind, Math.min(stamp - 1, input.view));
				for (const target of players) {
					if (target === player || !target.connected || target.status !== STATUS.free) continue;
					if (!ability.targets.includes(target.character.id)) continue;
					const at = placeAt(target, seen);
					if (Math.hypot(at.x - player.body.x, at.y - player.body.y) > ability.reach) continue;
					target.status = ability.effect === 'catch' ? STATUS.out : STATUS.stunned;
					target.until = stamp + ability.hold;
					player.score += ability.score;
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
				if (player.status === STATUS.out) spawn(player);
				free(player);
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
						player.score += rules.round.goalScore;
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
