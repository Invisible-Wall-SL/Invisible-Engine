/**
 * Bots of an online room (`docs/design/realtime-multiplayer.md` §7, P10.16): a player the server
 * plays with a P10.11 brain (`behaviours.js`) instead of a device's inputs.
 *
 * A bot does not move itself. Each step its brain looks at the room's free players and decides a
 * velocity; {@link botInput} turns that into an ordinary clamped input — a move, and an ability's
 * button while one of its targets is within reach — and the room applies it exactly as it applies
 * a device's (`online.js` `stepPlayer`, then the rules). So a bot is held to its character's speed,
 * its cooldowns and the rules like anyone, and a device draws it like any other player.
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
 * has (the room's resolved `rules.abilities`), and the `seq` its next input carries.
 */
export function createBot({ brain, seed, at, abilities = [], character }) {
	return {
		brain: createBrain(brain, { rng: createRng(seed), at }),
		abilities: abilities.filter((a) => a.character === character),
		seq: 0,
	};
}

/**
 * The bot's input for the next step, clamped onto `field`. `self` is its player (`{ body, character
 * }`), `players` everyone in the room; the brain sees the connected players other than itself that
 * can be hit (free, or grounded on a sandbank), and steps by the room's `dt` (seconds). `speed` is its character's full tilt: a brain that
 * wants to go faster is full tilt. `view` is the room's current step: a bot sees the present.
 */
export function botInput(bot, self, players, { dt, speed, field, view }) {
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
		let nearest;
		for (const target of visible) {
			if (!ability.targets.includes(target.character.id)) continue;
			const distance = Math.hypot(target.body.x - self.body.x, target.body.y - self.body.y);
			if (distance <= ability.reach && (!nearest || distance < nearest.distance))
				nearest = { target, distance };
		}
		if (!nearest) continue;
		buttons |= BUTTONS[ability.button];
		aimX = nearest.target.body.x;
		aimY = nearest.target.body.y;
	}
	const scale = speed > 0 ? MOVE_SCALE / speed : 0;
	bot.seq += 1;
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
