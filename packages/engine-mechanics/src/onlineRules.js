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
 * or `catch` (the target is out, then respawns), and it may score; or `hook`, which hands the
 * nearest target to the rules module (Salmons' line reels it in). A player whose status ends, who
 * respawns or who starts a round cannot be hit for {@link GRACE_MS}, and a respawn forgets the
 * player's past places, so nobody is hit where it no longer was. A round ends at the goal or on its
 * clock; the next starts `nextRoundSeconds` later with everyone back at the spawn and every score
 * at 0. Players move in every phase, so a device's prediction holds through the pause.
 *
 * A bot (`player.bot`, P10.16) plays by the same rules, but it neither reaches the goal nor tops a
 * round's scores unless the game's `bots.canWin` says it may.
 *
 * Steps are counted as the room counts them: `stamp` is the room step a state is stamped with
 * (`steps` after the step that made it), and every time is a whole number of steps. Within one
 * step, players act in the order they joined.
 */

import { BUTTONS, clipToField, levelCell } from './online.js';
import {
	GRACE_MS,
	STATUS,
	abilitySpecs,
	endStatuses,
	freeActor,
	stepsOf,
	useAbilities,
} from './abilities.js';
import { aabbOf, createStaticIndex, inZone, queryStatic, touching } from './motion.js';
import { SALMONS_RULES } from './salmonsRules.js';

/** A player's status and its grace are the abilities' ({@link STATUS}, `abilities.js`, P11.5). */
export { GRACE_MS, STATUS };

/** How far back an ability is tested against what its user saw, at most, ms (§6: lag
 *  compensation). Whole steps, rounded down. */
export const REWIND_MS = 250;

/** The message type every room event travels as (`services/game-server` broadcasts each step's
 *  events as one array of it; `apps/lines` `game/online.ts` reads it). */
export const ONLINE_EVENT = 'event';

/** A running score stays well inside the wire's int32, however long a round lasts. */
const SCORE_LIMIT = 1e9;

/** Add `points` to a player's score, held to ±{@link SCORE_LIMIT}. */
const score = (player, points) => {
	player.score = Math.max(-SCORE_LIMIT, Math.min(SCORE_LIMIT, player.score + points));
};

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

/**
 * The named rules modules (`arcade.online.rules.module`): code for what the data cannot say.
 * `game-config` lists the same ids. A module is either the hooks themselves (`tag`) or
 * `create(game, api)` returning them, for one room. Every hook is optional and runs only while a
 * round runs: `step(world)` once a step; `input(player, input, world)` (a world with no players) after each input the room
 * applies, also for a player it holds; `hook(user, target, ability, world)` for a `hook` ability's
 * nearest target (true: it took it); `worth(player, points)` what a catch of, or a goal by,
 * `player` scores; `reset(world)` at a round's start. `api` is {@link ModuleApi}.
 */
export const ONLINE_RULES_MODULES = Object.freeze({ tag, ...SALMONS_RULES });

/**
 * The rules of one room. `game` is the room's `OnlineGame`; `spawn(player)` puts a player back at
 * the start (the room owns where that is); `seed` is the room's, for a module's choices. The room
 * calls {@link OnlineRules.applied} after each input it applies and {@link OnlineRules.afterStep}
 * once a step; both may push events.
 */
export function createOnlineRules(game, { spawn, seed = 0 }) {
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
	const abilities = abilitySpecs(rules.abilities, tickHz).map((a) => ({
		...a,
		bit: BUTTONS[a.button],
	}));
	/** Whether a player can win a round: a bot only when the game lets bots win (P10.16). */
	const canWin = (player) => !player.bot || online.bots?.canWin === true;
	/** id → past places, a ring by stamp. */
	const history = new Map();
	const events = [];
	let phase = 'waiting';
	let round = 0;
	let endsAt = 0;
	let winner = '';

	const emit = (event) => events.push(event);
	const worldOf = (every, stamp) => ({ players: [...every], stamp, tickHz, round, seed, emit });
	/** What `points` for a catch of, or a goal by, `player` are worth (a module may say more). */
	const worth = (player, points) => (module?.worth ? module.worth(player, points) : points);

	const placeAt = (player, stamp) => {
		const ring = history.get(player.id);
		const slot = stamp % (rewind + 1);
		if (ring && ring.stamps[slot] === stamp) return { x: ring.xs[slot], y: ring.ys[slot] };
		return { x: player.body.x, y: player.body.y };
	};

	const free = (player, stamp) => freeActor(player, stamp, grace);

	/** Back to the start: its past places are not where it is any more. */
	const respawn = (player) => {
		spawn(player);
		history.delete(player.id);
	};

	const definition = rules.module ? ONLINE_RULES_MODULES[rules.module] : undefined;
	const module = definition?.create
		? definition.create(game, {
				STATUS,
				free,
				release: (player) => {
					player.status = STATUS.free;
					player.until = 0;
				},
				score,
				worth: (player, points) => worth(player, points),
			})
		: definition;

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
		module?.reset?.(worldOf(players, stamp));
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
			if (!canWin(p)) continue;
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
			if (phase !== 'running') return;
			if (module?.input) module.input(player, input, { stamp, tickHz, round, seed, emit });
			if (player.status !== STATUS.free) return;
			const seen = Math.max(stamp - 1 - rewind, Math.min(stamp - 1, input.view));
			useAbilities(player, stamp, abilities, {
				pressed: (ability) => (input.buttons & ability.bit) !== 0,
				used: (ability) => emit({ type: 'ability', by: player.id, button: ability.button }),
				players: () => [...every],
				present: (target) => target.connected,
				placeOf: (target) => placeAt(target, seen),
				hit: (target, ability) => {
					score(player, worth(target, ability.score));
					emit({
						type: ability.effect === 'catch' ? 'caught' : 'hit',
						by: player.id,
						target: target.id,
						effect: ability.effect,
					});
				},
				hook: (target, ability, players) => {
					if (module?.hook) module.hook(player, target, ability, worldOf(players, stamp));
				},
			});
		},
		/** Once a step, after every player moved: the step is now `stamp`. Returns its events. */
		afterStep(every, stamp) {
			const players = [...every];
			endStatuses(players, stamp, grace, respawn);
			if (phase === 'running') {
				if (goals.shapes.length) {
					for (const player of players) {
						if (!player.connected || player.status !== STATUS.free || !canWin(player)) continue;
						const reached = queryStatic(goals, aabbOf(player.body)).some(
							(goal) =>
								(!goal.characters || goal.characters.includes(player.character.id)) &&
								inZone(player.body, goal),
						);
						if (!reached) continue;
						score(player, worth(player, rules.round.goalScore));
						endRound(stamp, player.id);
						break;
					}
				}
				if (phase === 'running' && module?.step) module.step(worldOf(players, stamp));
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
