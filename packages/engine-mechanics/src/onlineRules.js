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
 * or `catch` (the target is out, then respawns), and it may score; or `hook`, which the rules
 * module casts at the user's aim (Salmons' travelling line). An `ahead` ability is tested from
 * that far along its user's last move. With `respawn: 'manual'` a caught person stays out until it
 * presses Respawn (an input's `respawn`, which the room reads: {@link OnlineRules.awaitsRespawn},
 * {@link OnlineRules.respawned}); a bot is back after the catch's `ms`. A player whose status
 * ends, who respawns or who starts a round cannot be hit for {@link GRACE_MS}, and a respawn forgets
 * the player's past places, so nobody is hit where it no longer was. A round ends at the goal or on
 * its clock; the next starts `nextRoundSeconds` later with everyone back at the spawn and every
 * score at 0 — unless `round.endsGame`: then the first round's end is the game's (`gameWon`, with
 * the winner's name), and no round follows. Players move in every phase, so a device's prediction holds through the pause. With a LOBBY (`rules.lobby`) the room waits
 * before its first round: each person who joins is told (`lobby`), and once `minPlayers` people are in or `maxWaitSeconds` have passed since the first,
 * a `countdown` of `countdownSeconds` runs (`endsAt` its end) and round 1 starts; a lobby every
 * person left starts over (one whose place is held after a drop still counts as there; it counts
 * towards the start again once it rejoins). Without one, the first join starts round 1.
 *
 * A bot (`player.bot`, P10.16) plays by the same rules, but it neither reaches the goal nor tops a
 * round's scores unless the game's `bots.canWin` says it may (Salmons' does); one that may not is
 * ignored in a goal.
 *
 * Steps are counted as the room counts them: `stamp` is the room step a state is stamped with
 * (`steps` after the step that made it), and every time is a whole number of steps. Within one
 * step, players act in the order they joined.
 */

import { BUTTONS, MOVE_SCALE, clipToField, levelCell } from './online.js';
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

/** A move longer than this (input units) is a direction an `ahead` ability faces (the original's
 *  `|v| > 0.01` of a full one). */
const AHEAD_MIN_MOVE = 0.01 * MOVE_SCALE;

/** An `ahead` ability's direction before its user has moved: the original Salmons' `{ vx: 1,
 *  vy: -1 }` (its `vx` along the river is `y` here, its `vy` across it `x`), as a unit vector. */
const AHEAD_FALLBACK = Object.freeze({ x: -Math.SQRT1_2, y: Math.SQRT1_2 });

/** The stains of a room whose rules leave none. */
const NO_STAINS = Object.freeze({ list: Object.freeze([]), made: 0 });

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
 * round runs: `step(world)` once a step; `input(player, input, world)` (a world with no players)
 * after each input the room applies, also for a player it holds; `holds(player)` whether it holds
 * a free player still; `level(player, level)` the level the room steps the player on (a solid it
 * may pass); `steer(player, input)` the input the room steps a free player it does not hold with
 * (a move it carries: `online.js` `carriedInput`); `cast(user, ability, aim, world)` for a `hook`
 * ability pressed off cooldown, at the input's aim (true: it took the cast, and the cooldown
 * starts); `sees(player, at)` whether `player` sees the world point `at` (a bot aims a `hook`
 * ability only at what it sees: `onlineBots.js`; none: it sees everything); `botAim`, a person's
 * limits for a bot's abilities (`onlineBots.js` `botInput`'s `aim`; none: no limit);
 * `botPlay(player, known, bot)` the module's own play of a bot (`botInput`'s `play`: its move and
 * buttons, or nothing for a bot it leaves to its brain); `worth(player, points)` what a catch
 * of, or a goal by, `player` scores; `reset(world)` at a round's start; `stains()` the marks it
 * left on the field (`{ list, made }`: Salmons' bloodstains, kept for the room's life, the newest
 * last; `made` counts every one ever left, so a room syncs only the new). `api` is
 * {@link ModuleApi}.
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
	let winnerName = '';
	const endsGame = rules.round.endsGame === true;
	const manual = rules.respawn === 'manual';
	/** The lobby (`rules.lobby`): when it gives up waiting for players, and when round 1 starts. */
	const lobby = rules.lobby;
	/** Whether the lobby has its first person (its wait runs from then). */
	let lobbyOpen = false;
	let lobbyEndsAt = 0;
	let startsAt = 0;
	/** People (not bots) the lobby counts towards its start: those connected now. */
	const people = (players) => players.filter((p) => !p.bot && p.connected).length;
	/** Whether the room still holds any person, connected or holding a dropped place. */
	const anyone = (players) => players.some((p) => !p.bot);

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

	/** Out, caught: until it presses Respawn (a person, `respawn: 'manual'`), else for `hold`. */
	const putOut = (player, stamp, hold) => {
		player.status = STATUS.out;
		player.until = manual && !player.bot ? Infinity : stamp + hold;
	};

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
				out: putOut,
			})
		: definition;

	/** Back on the ground, carrying nothing: a module's lift and carry (`online.js`
	 *  `carriedInput`), written only for a player that has them. */
	const settle = (player) => {
		if (player.z) player.z = 0;
		if (player.air || player.carryX || player.carryY) {
			player.air = 0;
			player.carryX = 0;
			player.carryY = 0;
		}
	};

	const startRound = (players, stamp) => {
		phase = 'running';
		round += 1;
		winner = '';
		winnerName = '';
		endsAt = rules.round.seconds ? stamp + Math.round(rules.round.seconds * tickHz) : 0;
		for (const player of players) {
			player.score = 0;
			player.mark = false;
			player.memo = {};
			player.cooldowns = {};
			settle(player);
			free(player, stamp);
			respawn(player);
		}
		emit({ type: 'roundStart', round });
		module?.reset?.(worldOf(players, stamp));
	};

	const endRound = (stamp, by) => {
		phase = 'ended';
		winner = by?.id ?? '';
		winnerName = by?.name ?? '';
		endsAt = endsGame ? 0 : stamp + Math.round(rules.round.nextRoundSeconds * tickHz);
		emit({ type: 'roundEnd', round, winner });
		if (endsGame) emit({ type: 'gameWon', winner, winnerName });
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
		return best && !tied ? best : undefined;
	};

	return {
		get phase() {
			return phase;
		},
		/** The marks the module left on the field ({@link NO_STAINS} when it leaves none). */
		get stains() {
			return module?.stains?.() ?? NO_STAINS;
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
		get winnerName() {
			return winnerName;
		},
		/** Whether a caught player waits for its Respawn (`respawn: 'manual'`) in a running round. */
		awaitsRespawn: (player) =>
			phase === 'running' && player.status === STATUS.out && player.until === Infinity,
		/** A player that pressed Respawn, back at its spawn as the character the room gave it. */
		respawned(player, stamp) {
			player.mark = false;
			player.memo = {};
			player.cooldowns = {};
			player.down = {};
			settle(player);
			free(player, stamp);
			respawn(player);
			emit({ type: 'respawned', id: player.id, character: player.character.id });
		},
		/** A Respawn the room refused: the character it picked has no place left. Told once a catch
		 *  (a device may send its Respawn on every input). */
		refused(player) {
			if (player.memo.refused === 1) return;
			player.memo.refused = 1;
			emit({ type: 'respawnRefused', id: player.id });
		},
		/** A player the room just let in: a new player's first join starts the first round. */
		joined(player, every, stamp) {
			player.score = 0;
			player.mark = false;
			player.memo = {};
			player.cooldowns = {};
			settle(player);
			free(player, stamp);
			if (phase === 'waiting' && !lobby) startRound([...every], stamp);
			emit({ type: 'joined', id: player.id });
			if (phase === 'waiting' && lobby && !player.bot) {
				if (!lobbyOpen) {
					lobbyOpen = true;
					lobbyEndsAt = stamp + Math.round(lobby.maxWaitSeconds * tickHz);
				}
				emit({ type: 'lobby', id: player.id });
			}
		},
		left(id) {
			history.delete(id);
			emit({ type: 'left', id });
		},
		/** Whether the room holds a player still (its inputs are taken but do not move it): its status,
		 *  or a module's hold (a salmon climbing a waterfall). */
		holds: (player) =>
			player.status !== STATUS.free || (phase === 'running' && module?.holds?.(player) === true),
		/** The level the room steps `player` on: `level`, or what a module makes of it for the player
		 *  (a salmon high enough passes over a waterfall). */
		level: (player, level) =>
			phase === 'running' && module?.level ? module.level(player, level) : level,
		/** The input the room steps `player` with: `input`, or what a module makes of it (a leaping
		 *  salmon carries its leap's move). Asked only for a free player the room does not hold. */
		steer: (player, input) =>
			phase === 'running' && module?.steer ? module.steer(player, input) : input,
		/** Whether `player` sees the world point `at`, as a module says (Salmons: a fisherman's
		 *  sight); with none, everything. */
		sees: (player, at) => (module?.sees ? module.sees(player, at) : true),
		/** A person's limits for a bot's abilities, as a module says (Salmons: a fisherman's reaction
		 *  time and the error of his cast, a bear's reaction time); with none, no limit. */
		botAim: module?.botAim,
		/** A module's own play of a bot (Salmons: a bot salmon's swim); with none, the brain's alone. */
		botPlay: module?.botPlay,
		/** After the room applied `input` for `player` during the step that will be `stamp`. */
		applied(player, input, every, stamp) {
			if (phase !== 'running') return;
			if (module?.input) module.input(player, input, { stamp, tickHz, round, seed, emit });
			if (player.status !== STATUS.free) return;
			const move = Math.hypot(input.moveX, input.moveY);
			if (move > AHEAD_MIN_MOVE) {
				player.memo.aheadX = input.moveX / move;
				player.memo.aheadY = input.moveY / move;
			}
			const seen = Math.max(stamp - 1 - rewind, Math.min(stamp - 1, input.view));
			let list;
			const all = () => (list ??= [...every]);
			useAbilities(player, stamp, abilities, {
				pressed: (ability) => (input.buttons & ability.bit) !== 0,
				used: (ability) => emit({ type: 'ability', by: player.id, button: ability.button }),
				players: all,
				present: (target) => target.connected,
				placeOf: (target) => placeAt(target, seen),
				aheadOf: (user) =>
					user.memo.aheadX === undefined
						? AHEAD_FALLBACK
						: { x: user.memo.aheadX, y: user.memo.aheadY },
				hit: (target, ability) => {
					if (ability.effect === 'catch') putOut(target, stamp, ability.hold);
					score(player, worth(target, ability.score));
					emit({
						type: ability.effect === 'catch' ? 'caught' : 'hit',
						by: player.id,
						target: target.id,
						effect: ability.effect,
						...(ability.effect === 'catch' ? { byName: player.name ?? '' } : {}),
					});
				},
				cast: (ability) =>
					module?.cast?.(
						player,
						ability,
						{ x: input.aimX, y: input.aimY },
						worldOf(all(), stamp),
					) === true,
			});
		},
		/** Once a step, after every player moved: the step is now `stamp`. Returns its events. */
		afterStep(every, stamp) {
			const players = [...every];
			endStatuses(players, stamp, grace, respawn);
			if (phase === 'running') {
				if (goals.shapes.length) {
					for (const player of players) {
						if (!player.connected || player.status !== STATUS.free) continue;
						if (!canWin(player)) continue;
						const reached = queryStatic(goals, aabbOf(player.body)).some(
							(goal) =>
								(!goal.characters || goal.characters.includes(player.character.id)) &&
								inZone(player.body, goal),
						);
						if (!reached) continue;
						score(player, worth(player, rules.round.goalScore));
						endRound(stamp, player);
						break;
					}
				}
				if (phase === 'running' && module?.step) module.step(worldOf(players, stamp));
				if (phase === 'running' && endsAt && stamp >= endsAt) endRound(stamp, leader(players));
				// A module's lift (a leap, a climb), its carry, its notes and its lines last only while a
				// round runs: back on the ground, off any hook, and its notes gone, as it ends.
				if (phase !== 'running')
					for (const player of players) {
						settle(player);
						player.memo = {};
						if (player.status === STATUS.hooked) free(player, stamp);
						if (player.lineActive) {
							player.lineActive = 0;
							player.lineX = 0;
							player.lineY = 0;
						}
					}
			} else if (phase === 'ended' && !endsGame && stamp >= endsAt) startRound(players, stamp);
			else if (phase === 'waiting' && lobby && lobbyOpen) {
				if (!anyone(players)) {
					lobbyOpen = false;
					lobbyEndsAt = 0;
					startsAt = 0;
					endsAt = 0;
				} else if (!startsAt && (people(players) >= lobby.minPlayers || stamp >= lobbyEndsAt)) {
					startsAt = stamp + Math.round(lobby.countdownSeconds * tickHz);
					endsAt = startsAt;
					emit({ type: 'countdown', seconds: lobby.countdownSeconds });
				}
				if (startsAt && stamp >= startsAt) startRound(players, stamp);
			}
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
