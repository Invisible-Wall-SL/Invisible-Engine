/**
 * Bots of an online room (`docs/design/realtime-multiplayer.md` §7, P10.16): a player the server
 * plays with a P10.11 brain (`behaviours.js`) instead of a device's inputs.
 *
 * A bot does not move itself. Each step its brain looks at the room's free players and decides a
 * velocity; {@link botInput} turns that into an ordinary clamped input — a move, and an ability's
 * button while one of its targets is within reach (and `ahead`; never for another bot when the
 * ability hits the bot's own class, unless its brain chases that bot; a line's cast (`hook`) aimed at its nearest target that a
 * person standing there could aim at, which is one the rules say it sees and its device would be
 * sent, the room's line-out and cooldown rules holding it back; an `onPress` button let go every
 * other input so it is pressed again) — and the room applies it exactly as it applies a device's
 * (`online.js` `stepPlayer`, then the rules). So a bot is held to its character's speed, its
 * cooldowns and the rules like anyone, and a device draws it like any other player.
 *
 * A bot given a person's ability is given a person's limits too, when the rules name them
 * ({@link botInput}'s `aim`). An aimed one (`aimed`): it casts at a target only after watching it
 * for a reaction time, not again until its line is home, it has rested and it has watched again;
 * it casts at what it saw a moment ago (the cast lands to the side of a target that moves, by as
 * far as it moved; one that keeps still is hit), and a long cast falls short, by more the longer it
 * is. One pressed within reach (`inReach`: a swipe): only once the target has been in reach for a
 * reaction time, and again after each press. With none it plays as a machine: at once, at the
 * target's exact place.
 *
 * What a brain's behaviours cannot say, the rules may play ({@link botInput}'s `play`: Salmons'
 * bot salmon, which swims a river only its rules know). They are told what a device in the bot's
 * place would be sent and the rules say it sees, and answer a move and buttons, clamped like any.
 *
 * Plain, dependency-free ESM beside `online.js`; seeded, so a room's bots replay exactly from the
 * room's seed (`scripts/check-room-bots.mjs`).
 */

import { createRng } from './board.js';
import {
	BEHAVIOUR_DEFAULTS,
	brainVelocity,
	createBrain,
	createBrainWorld,
	stepBrain,
} from './behaviours.js';
import { BUTTONS, MOVE_SCALE, sanitizeInput } from './online.js';
import { STATUS } from './onlineRules.js';

/** The id every bot's player has, `bot:<n>`: a Colyseus session id (nanoid: letters, digits, `_`
 *  and `-`) never contains a `:`. */
export const BOT_PREFIX = 'bot:';

/** Whether a room player id is a bot's. */
export const isBotId = (id) => typeof id === 'string' && id.startsWith(BOT_PREFIX);

/**
 * A bot's own state: its brain (seeded with `seed`, spawned at `at`), the abilities its character
 * has (the room's resolved `rules.abilities`), the `seq` its next input carries, and its aim: a
 * stream of its own (`aimRng`: the brain draws what it drew before there was one), the targets it
 * is watching (`watched`: an ability's button and a target's id → the `seq` it last saw the target
 * at, the `seq` from which it has watched it long enough and, for an aimed ability, where it saw it
 * on each of its last inputs), and the `seq` before which it rests after a cast, by button (`rest`).
 * `hunts` are the tags its brain chases. For rules that play it ({@link botInput}'s `play`): the
 * notes they keep of it (`notes`) and seeded streams of its own by name (`stream`: none of them the
 * brain's or the aim's, so those draw what they drew).
 */
export function createBot({ brain, seed, at, abilities = [], character }) {
	const streams = new Map();
	return {
		brain: createBrain(brain, { rng: createRng(seed), at }),
		abilities: abilities.filter((a) => a.character === character),
		seq: 0,
		buttons: 0,
		aimRng: createRng(`${seed}:aim`),
		watched: new Map(),
		rest: new Map(),
		hunts: new Set(
			brain.states
				.filter((state) => state.behaviour === 'chase')
				.map((state) => state.params?.tag ?? BEHAVIOUR_DEFAULTS.chase.tag),
		),
		notes: {},
		stream(name) {
			let rng = streams.get(name);
			if (!rng) streams.set(name, (rng = createRng(`${seed}:play:${name}`)));
			return rng;
		},
	};
}

/** Whether a bot's brain chases `target`: its body has a tag a `chase` state of the brain names. */
const hunted = (bot, target) =>
	Array.isArray(target.body.tags) && target.body.tags.some((tag) => bot.hunts.has(tag));

/**
 * Whether the bot has watched `target` for its reaction time, for `ability`: a time drawn between
 * `reactMs.min` and `reactMs.max` when the target came into its sight (an aimed ability) or its
 * reach (any other), counted in inputs (one a step of `dt` seconds). Asked on every input the
 * target is there; one it was not asked of on the last input is new to it ({@link botInput}
 * forgets those).
 */
const reacted = (bot, ability, target, seq, { reactMs, lagMs }, dt) => {
	const key = `${ability.button}:${target.id}`;
	let watch = bot.watched.get(key);
	if (!watch) {
		watch = { ready: seq + steps(bot, reactMs, dt) };
		bot.watched.set(key, watch);
	}
	watch.seen = seq;
	if (lagMs) {
		watch.trail ??= [];
		watch.trail.push({ x: target.body.x, y: target.body.y });
		if (watch.trail.length > Math.round(lagMs.max / 1000 / dt) + 1) watch.trail.shift();
	}
	return seq >= watch.ready ? watch : undefined;
};

/** A time drawn from the bot's aim stream between `ms.min` and `ms.max`, in inputs of `dt` s. */
const steps = (bot, ms, dt) => Math.round((ms.min + bot.aimRng() * (ms.max - ms.min)) / 1000 / dt);

/**
 * How far to the side of its target a cast at it lands, the target at `(dx, dy)` from the bot: as
 * far as it moved in a moment (`lagMs`, drawn for the cast, read off the `trail` of places
 * {@link reacted} kept, so no further back than it has watched the target), across the line from
 * the bot to it, on the side it came from. A person casts at what he saw, so a target that keeps
 * still is where he aims and one that swims is gone by that much. Across, not along: a bobber that lands short of a target coming at him is swum into,
 * and one beyond it is reeled home through it (Salmons' line), so neither would miss.
 */
const lagError = (bot, watch, { dx, dy, distance }, lagMs, dt) => {
	const back = Math.min(steps(bot, lagMs, dt), watch.trail.length - 1);
	const now = watch.trail[watch.trail.length - 1];
	const then = watch.trail[watch.trail.length - 1 - back];
	const mx = now.x - then.x;
	const my = now.y - then.y;
	const moved = Math.hypot(mx, my);
	if (!moved || !distance) return { x: 0, y: 0 };
	const across = (mx * -dy + my * dx) / distance;
	const side = across > 0 || (across === 0 && bot.aimRng() < 0.5) ? -1 : 1;
	return { x: (side * -dy * moved) / distance, y: (side * dx * moved) / distance };
};

/**
 * How far off its target a cast lands, the target `distance` px from the bot along `(dx, dy)`:
 * short of it. A point drawn evenly over the disc that reaches from the target back towards the
 * bot, as wide as `spread` of what the cast is longer than `surePx` (no longer than that: on the
 * target). Never past the target: a line reeled home through its target (Salmons') takes it on the
 * way, so a cast that lands beyond is no miss.
 */
const aimError = (bot, { dx, dy, distance }, { surePx, spread }) => {
	const radius = (Math.max(0, distance - surePx) * spread) / 2;
	const off = radius * Math.sqrt(bot.aimRng());
	const turn = bot.aimRng() * 2 * Math.PI;
	const short = distance > 0 ? radius / distance : 0;
	return { x: Math.cos(turn) * off - dx * short, y: Math.sin(turn) * off - dy * short };
};

/**
 * The bot's input for the next step, clamped onto `field`. `self` is its player (`{ body, character
 * }`), `players` everyone in the room; the brain sees the connected players other than itself that
 * can be hit (free, or grounded on a sandbank), and steps by the room's `dt` (seconds). `speed` is
 * its character's full tilt: a brain that wants to go faster is full tilt. `view` is the room's
 * current step: a bot sees the present.
 *
 * A `hook` ability is aimed, so its targets are those a person in the bot's place could aim at:
 * `sees(self, at)` is the rules' answer for a world point (`onlineRules.js` `sees`; none: every
 * point), and `nearby` the room's `online.nearby` box, about the bot as about a device's own player
 * (none: the whole room is sent). `aim` is the rules' numbers for a person's eye and hand
 * (`onlineRules.js` `botAim`; none: no limit). `aim.aimed`, for a `hook`: the bot aims only at a
 * target it has watched for its reaction time ({@link reacted}), watches nothing while its line is
 * out (`self.lineActive`: every target is new to it once the line is home) and every target anew
 * after a press the room refused (after its rest, which a refused press costs too), and the press is aimed short of the target by the cast's error
 * ({@link aimError}) and to the side by as far as the target moved in `aim.aimed.lagMs`
 * ({@link lagError}; none: not to the side), and after a cast it rests for `aim.aimed.restMs` (none:
 * not at all) before it watches again. `aim.inReach`, for any other ability: it presses only for a
 * target that has been within reach for its reaction time (out of reach for one input and it
 * starts again), and after a press every target anew.
 *
 * `play` is the rules' own play of a bot (`onlineRules.js` `botPlay`; none: the brain's alone). It
 * is asked on every input with the bot's player, the players a person in its place could know of
 * (those of the brain's that are in the `nearby` box about it and that it `sees`) and the bot's own
 * `{ seq, dt, state, notes, stream }` (`state` the brain's), and answers `{ moveX, moveY, buttons }`
 * in input units, the buttons in place of none, or nothing: then the brain moves the bot.
 */
export function botInput(bot, self, players, { dt, speed, field, view, sees, nearby, aim, play }) {
	const seq = bot.seq + 1;
	const bodies = [self.body];
	const visible = [];
	for (const player of players) {
		if (player === self || !player.connected) continue;
		if (player.status !== STATUS.free && player.status !== STATUS.grounded) continue;
		bodies.push(player.body);
		visible.push(player);
	}
	const world = createBrainWorld({ self: self.body, bodies });
	stepBrain(bot.brain, world, dt);
	const velocity = brainVelocity(bot.brain, self.body, world, dt);
	let buttons = 0;
	let aimX = self.body.x;
	let aimY = self.body.y;
	for (const ability of bot.abilities) {
		const aimed = ability.effect === 'hook';
		const limit = aimed ? aim?.aimed : aim?.inReach;
		// Its eyes are on its line while that is out, and it rests a while after each cast.
		if (aimed && limit && (self.lineActive || seq < (bot.rest.get(ability.button) ?? 0))) continue;
		const reach = ability.reach + (ability.ahead ?? 0);
		let nearest;
		for (const target of visible) {
			if (!ability.targets.includes(target.character.id)) continue;
			// An ability that hits its own class (Salmons' bear) is not pressed for another bot, but
			// for one its brain chases (a bot salmon).
			if (target.bot && ability.targets.includes(self.character.id) && !hunted(bot, target))
				continue;
			const dx = target.body.x - self.body.x;
			const dy = target.body.y - self.body.y;
			const distance = Math.hypot(dx, dy);
			// A line is cast at a target (the bobber's reach is the hook's), not from within reach of it.
			if (aimed) {
				if (nearby && (Math.abs(dx) > nearby.w / 2 || Math.abs(dy) > nearby.h / 2)) continue;
				if (sees && !sees(self, target.body)) continue;
			} else if (distance > reach) continue;
			const watch = limit && reacted(bot, ability, target, seq, limit, dt);
			if (limit && !watch) continue;
			if (!nearest || distance < nearest.distance) nearest = { target, distance, dx, dy, watch };
		}
		if (!nearest) continue;
		const bit = BUTTONS[ability.button];
		if (ability.onPress && bot.buttons & bit) continue;
		buttons |= bit;
		aimX = nearest.target.body.x;
		aimY = nearest.target.body.y;
		if (limit) {
			if (aimed) {
				const error = aimError(bot, nearest, limit);
				const lag = limit.lagMs
					? lagError(bot, nearest.watch, nearest, limit.lagMs, dt)
					: { x: 0, y: 0 };
				aimX += error.x + lag.x;
				aimY += error.y + lag.y;
				if (limit.restMs) bot.rest.set(ability.button, seq + steps(bot, limit.restMs, dt));
			}
			bot.watched.clear();
		}
	}
	for (const [id, watch] of bot.watched) if (watch.seen !== seq) bot.watched.delete(id);
	const scale = speed > 0 ? MOVE_SCALE / speed : 0;
	let moveX = velocity.vx * scale;
	let moveY = velocity.vy * scale;
	if (play) {
		const known = visible.filter(
			(other) =>
				(!nearby ||
					(Math.abs(other.body.x - self.body.x) <= nearby.w / 2 &&
						Math.abs(other.body.y - self.body.y) <= nearby.h / 2)) &&
				(!sees || sees(self, other.body)),
		);
		const played = play(self, known, {
			seq,
			dt,
			state: bot.brain.state,
			notes: bot.notes,
			stream: bot.stream,
		});
		if (played) {
			moveX = played.moveX;
			moveY = played.moveY;
			buttons |= played.buttons;
		}
	}
	bot.seq = seq;
	bot.buttons = buttons;
	return sanitizeInput(
		{
			seq: bot.seq,
			moveX,
			moveY,
			buttons,
			aimX,
			aimY,
			view,
		},
		field,
	);
}
