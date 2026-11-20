/**
 * Types for an online room's bots (`onlineBots.js`, `docs/design/realtime-multiplayer.md` §7).
 * The behaviour is pinned by `scripts/check-room-bots.mjs`.
 */

import type { Brain, BrainSpec } from './behaviours';
import type { Point } from './motion';
import type { OnlineInput } from './online';
import type { RulesPlayer } from './onlineRules';

export const BOT_PREFIX: 'bot:';
export function isBotId(id: unknown): boolean;

export type BotAbility = {
	character: string;
	button: 'ability1' | 'ability2';
	reach: number;
	targets: readonly string[];
	effect?: string;
	ahead?: number;
	onPress?: boolean;
};

/**
 * A person's limits for a bot, as a rules module says (`RulesHooks.botAim`), each kind of ability
 * limited only when named.
 *
 * `aimed`, a `hook` ability (Salmons' `BOT_AIM`): a target must have been in the bot's sight for a
 * reaction time, drawn between `reactMs.min` and `reactMs.max` as it comes into it, before the bot
 * casts at it, and again once its line is home. A cast longer than `surePx` falls short: the bobber
 * lands up to `spread` of what the cast is longer nearer the bot than the target, and up to half of
 * that to either side.
 *
 * `inReach`, any other ability, pressed while a target is within reach (Salmons' `BOT_SWIPE`): the
 * target must have been within reach for a reaction time, drawn the same way, before the bot
 * presses for it, and again after each press.
 */
export type BotAim = {
	aimed?: { reactMs: { min: number; max: number }; surePx: number; spread: number };
	inReach?: { reactMs: { min: number; max: number } };
};

export type OnlineBot = {
	readonly brain: Brain;
	readonly abilities: readonly BotAbility[];
	seq: number;
	/** The buttons of its last input. */
	buttons: number;
	/** Its aim's own stream: a reaction time for each target watched, an error for each cast. */
	readonly aimRng: () => number;
	/** The targets it is watching, by an ability's button and a target's id (`ability1:<id>`): the
	 *  `seq` it last saw each at, and the `seq` from which it has watched it for its reaction time. */
	readonly watched: Map<string, { seen: number; ready: number }>;
};

export function createBot(options: {
	brain: BrainSpec;
	seed: number | string;
	at: Point;
	abilities?: readonly BotAbility[];
	character: string;
}): OnlineBot;

export function botInput(
	bot: OnlineBot,
	self: RulesPlayer,
	players: Iterable<RulesPlayer>,
	options: {
		dt: number;
		speed: number;
		field: { w: number; h: number };
		view: number;
		/** Whether the bot sees a world point, for a `hook` ability's aim; none: every point. */
		sees?: (self: RulesPlayer, at: { x: number; y: number }) => boolean;
		/** The room's `online.nearby` box: a `hook` ability's target is inside it about the bot. */
		nearby?: { w: number; h: number };
		/** A person's limits on its abilities; none: it presses at once, aimed at the target's place. */
		aim?: BotAim;
	},
): OnlineInput;
