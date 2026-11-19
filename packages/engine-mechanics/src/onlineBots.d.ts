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

export type OnlineBot = {
	readonly brain: Brain;
	readonly abilities: readonly BotAbility[];
	seq: number;
	/** The buttons of its last input. */
	buttons: number;
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
	},
): OnlineInput;
