/**
 * Types for an online room's rules (`onlineRules.js`, `docs/design/realtime-multiplayer.md` §4).
 * The behaviour is pinned by `scripts/check-online-rules.mjs`.
 */

import type { Body } from './motion';
import type { OnlineInput } from './online';

export const STATUS: Readonly<{ free: 0; stunned: 1; out: 2 }>;
export const REWIND_MS: 250;
export const GRACE_MS: 1000;
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
	| { type: 'roundEnd'; round: number; winner: string };

export type RulesWorld = {
	players: RulesPlayer[];
	stamp: number;
	tickHz: number;
	emit(event: OnlineEvent): void;
};

export const ONLINE_RULES_MODULES: Readonly<Record<string, { step(world: RulesWorld): void }>>;

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

export function createOnlineRules(
	game: {
		field: { w: number; h: number };
		zones: readonly { id: string; x: number; y: number; w: number; h: number }[];
		online: {
			tickHz: number;
			bots?: { canWin: boolean };
			rules: {
				zones: readonly { zone: string; goal?: boolean; characters?: string[] }[];
				abilities: readonly {
					character: string;
					button: 'ability1' | 'ability2';
					reach: number;
					targets: string[];
					effect: 'catch' | 'stun';
					ms: number;
					score: number;
					cooldownMs: number;
				}[];
				round: { seconds?: number; nextRoundSeconds: number; goalScore: number };
				module?: string;
			};
		};
	},
	options: { spawn(player: RulesPlayer): void },
): OnlineRules;
