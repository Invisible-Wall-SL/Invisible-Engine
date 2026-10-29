/**
 * Types for an online room's rules (`onlineRules.js`, `docs/design/realtime-multiplayer.md` §4).
 * The behaviour is pinned by `scripts/check-online-rules.mjs`.
 */

import type { Body } from './motion';
import type { OnlineInput } from './online';

import type { STATUS } from './abilities';

export { GRACE_MS, STATUS } from './abilities';
export const REWIND_MS: 250;
export const ONLINE_EVENT: 'event';

export type OnlinePhase = 'waiting' | 'running' | 'ended';

/** A player as the rules see it: the room's own record, mutated in place. */
export type RulesPlayer = {
	id: string;
	character: { id: string };
	body: Body;
	connected: boolean;
	score: number;
	status: number;
	/** The stamp its status ends at. */
	until: number;
	/** The stamp before which it cannot be hit. */
	safeUntil: number;
	/** A rules module's flag (`tag`: "it"). */
	mark: boolean;
	/** A rules module's own notes on the player. */
	memo: Record<string, number>;
	/** Button → the stamp it can be used again at. */
	cooldowns: Record<string, number>;
	/** A bot the server plays (P10.16). */
	bot?: boolean;
};

export type OnlineEvent =
	| { type: 'joined' | 'left'; id: string }
	| { type: 'ability'; by: string; button: string }
	| { type: 'hit' | 'caught'; by: string; target: string; effect: string }
	| { type: 'roundStart'; round: number }
	| { type: 'roundEnd'; round: number; winner: string }
	| { type: 'climbed' | 'grounded'; id: string; zone: string }
	| { type: 'jumped' | 'golden'; id: string }
	| { type: 'hooked' | 'escaped'; by: string; target: string };

export type RulesWorld = {
	players: RulesPlayer[];
	stamp: number;
	tickHz: number;
	/** The round running. */
	round: number;
	/** The room's seed. */
	seed: number;
	emit(event: OnlineEvent): void;
};

/** An ability as a module's `hook` gets it: `hold` is its `ms` in steps. */
export type RulesAbility = { score: number; hold: number; reach: number; button: string };

/** What a rules module's hooks may do to the room (P11.3). */
export type ModuleApi = {
	STATUS: typeof STATUS;
	/** Free a player, safe from hits for {@link GRACE_MS}. */
	free(player: RulesPlayer, stamp: number): void;
	/** Free a player with no grace. */
	release(player: RulesPlayer): void;
	score(player: RulesPlayer, points: number): void;
	worth(player: RulesPlayer, points: number): number;
};

/** A rules module's hooks, every one optional (`ONLINE_RULES_MODULES`). */
export type RulesHooks = {
	step?(world: RulesWorld): void;
	/** Its world has no players: an input is the player's own. */
	input?(player: RulesPlayer, input: OnlineInput, world: Omit<RulesWorld, 'players'>): void;
	hook?(user: RulesPlayer, target: RulesPlayer, ability: RulesAbility, world: RulesWorld): boolean;
	worth?(player: RulesPlayer, points: number): number;
	reset?(world: RulesWorld): void;
};

export type RulesModule = RulesHooks | { create(game: RulesGame, api: ModuleApi): RulesHooks };

export const ONLINE_RULES_MODULES: Readonly<Record<string, RulesModule>>;

export type OnlineRules = {
	readonly phase: OnlinePhase;
	readonly round: number;
	/** The stamp the phase ends at; 0 = never. */
	readonly endsAt: number;
	readonly winner: string;
	joined(player: RulesPlayer, players: Iterable<RulesPlayer>, stamp: number): void;
	left(id: string): void;
	holds(player: RulesPlayer): boolean;
	applied(
		player: RulesPlayer,
		input: OnlineInput,
		players: Iterable<RulesPlayer>,
		stamp: number,
	): void;
	afterStep(players: Iterable<RulesPlayer>, stamp: number): OnlineEvent[];
	take(): OnlineEvent[];
};

/** What of an online game the rules read. */
export type RulesGame = {
	field: { w: number; h: number };
	zones: readonly { id: string; x: number; y: number; w: number; h: number }[];
	online: {
		tickHz: number;
		bots?: { canWin: boolean };
		rules: {
			zones: readonly {
				zone: string;
				goal?: boolean;
				kind?: string;
				characters?: string[];
			}[];
			abilities: readonly {
				character: string;
				button: 'ability1' | 'ability2';
				reach: number;
				targets: string[];
				effect: 'catch' | 'stun' | 'hook';
				ms: number;
				score: number;
				cooldownMs: number;
			}[];
			round: { seconds?: number; nextRoundSeconds: number; goalScore: number };
			module?: string;
		};
	};
};

export function createOnlineRules(
	game: RulesGame,
	options: { spawn(player: RulesPlayer): void; seed?: number },
): OnlineRules;
