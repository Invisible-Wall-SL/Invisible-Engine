/**
 * Bots of an online room (`docs/design/realtime-multiplayer.md` §7, P10.16): a player the server
 * plays with a P10.11 brain (`behaviours.js`) instead of a device's inputs.
 *
 * A bot does not move itself. Each step its brain looks at the room's free players and decides a
 * velocity; {@link botInput} turns that into an ordinary clamped input — a move, and an ability's
 * button while one of its targets is within reach (and `ahead`; never for another bot when the
 * ability hits the bot's own class; a line's cast (`hook`) aimed at its nearest target that a
 * person standing there could aim at, which is one the rules say it sees and its device would be
 * sent, the room's line-out and cooldown rules holding it back; an `onPress` button let go every
 * other input so it is pressed again) — and the room applies it exactly as it applies a device's
 * (`online.js` `stepPlayer`, then the rules). So a bot is held to its character's speed, its
 * cooldowns and the rules like anyone, and a device draws it like any other player.
 *
 * A bot given a person's aimed ability is given a person's limits too, when the rules name them
 * ({@link botInput}'s `aim`): it casts at a target only after watching it for a reaction time, not
 * again until its line is home and it has watched again, and a long cast falls short, by more the
 * longer it is. With none it aims as a machine: at once, at the target's exact place.
 *
 * Plain, dependency-free ESM beside `online.js`; seeded, so a room's bots replay exactly from the
 * room's seed (`scripts/check-room-bots.mjs`).
 */

import { createRng } from './board.js';
import { brainVelocity, createBrain, createBrainWorld, stepBrain } from './behaviours.js';
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
 * stream of its own (`aimRng`: the brain draws what it drew before there was one) and the targets it
 * is watching (`watched`: id → the `seq` it last saw the target at, and the `seq` from which it has
 * watched it long enough).
 */
export function createBot({ brain, seed, at, abilities = [], character }) {
	return {
		brain: createBrain(brain, { rng: createRng(seed), at }),
		abilities: abilities.filter((a) => a.character === character),
		seq: 0,
		buttons: 0,
		aimRng: createRng(`${seed}:aim`),
		watched: new Map(),
	};
}

/**
 * Whether the bot has watched `target` for its reaction time: a time drawn between `reactMs.min`
 * and `reactMs.max` when the target came into its sight, counted in inputs (one a step of `dt`
 * seconds). Asked on every input the target is in its sight; one it was not asked of on the last
 * input is new to it ({@link botInput} forgets those).
 */
const reacted = (bot, target, seq, { reactMs }, dt) => {
	let watch = bot.watched.get(target.id);
	if (!watch) {
		const ms = reactMs.min + bot.aimRng() * (reactMs.max - reactMs.min);
		watch = { ready: seq + Math.round(ms / 1000 / dt) };
		bot.watched.set(target.id, watch);
	}
	watch.seen = seq;
	return seq >= watch.ready;
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
 * (`onlineRules.js` `botAim`; none: no limit): the bot aims only at a target it has watched for its
 * reaction time ({@link reacted}), watches nothing while its line is out (`self.lineActive`: every
 * target is new to it once the line is home) and every target anew after a press the room refused,
 * and the press is aimed short of the target by the cast's error ({@link aimError}).
 */
export function botInput(bot, self, players, { dt, speed, field, view, sees, nearby, aim }) {
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
		const limited = aimed && Boolean(aim);
		// Its eyes are on its line while that is out.
		if (limited && self.lineActive) continue;
		const reach = ability.reach + (ability.ahead ?? 0);
		let nearest;
		for (const target of visible) {
			if (!ability.targets.includes(target.character.id)) continue;
			// An ability that hits its own class (Salmons' bear) is not pressed for another bot.
			if (target.bot && ability.targets.includes(self.character.id)) continue;
			const dx = target.body.x - self.body.x;
			const dy = target.body.y - self.body.y;
			// A line is cast at a target (the bobber's reach is the hook's), not from within reach of it.
			if (aimed) {
				if (nearby && (Math.abs(dx) > nearby.w / 2 || Math.abs(dy) > nearby.h / 2)) continue;
				if (sees && !sees(self, target.body)) continue;
				if (limited && !reacted(bot, target, seq, aim, dt)) continue;
			}
			const distance = Math.hypot(dx, dy);
			if ((aimed || distance <= reach) && (!nearest || distance < nearest.distance))
				nearest = { target, distance, dx, dy };
		}
		if (!nearest) continue;
		const bit = BUTTONS[ability.button];
		if (ability.onPress && bot.buttons & bit) continue;
		buttons |= bit;
		aimX = nearest.target.body.x;
		aimY = nearest.target.body.y;
		if (limited) {
			const error = aimError(bot, nearest, aim);
			aimX += error.x;
			aimY += error.y;
			bot.watched.clear();
		}
	}
	for (const [id, watch] of bot.watched) if (watch.seen !== seq) bot.watched.delete(id);
	const scale = speed > 0 ? MOVE_SCALE / speed : 0;
	bot.seq = seq;
	bot.buttons = buttons;
	return sanitizeInput(
		{
			seq: bot.seq,
			moveX: velocity.vx * scale,
			moveY: velocity.vy * scale,
			buttons,
			aimX,
			aimY,
			view,
		},
		field,
	);
}
