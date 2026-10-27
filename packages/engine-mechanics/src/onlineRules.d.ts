/**
 * Types for an online room's rules (`onlineRules.js`, `docs/design/realtime-multiplayer.md` §4).
 * The behaviour is pinned by `scripts/check-online-rules.mjs`.
 */

import type { Body } from './motion';
import type { OnlineInput } from './online';

export const STATUS: Readonly<{ free: 0; stunned: 1; out: 2 }>;
export const REWIND_MS: 250;
export const PHASES: readonly ['waiting', 'running', 'ended'];

export type OnlinePhase = (typeof PHASES)[number];

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
	/** A rules module's flag (`tag`: "it"). */
	mark: boolean;
	/** A rules module's own notes on the player. */
	memo: Record<string, number>;
	/** Button → the stamp it can be used again at. */
	cooldowns: Record<string, number>;
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
		zones: readonly { id: string; x: number; y: number; w: number; h: number }[];
		online: {
			tickHz: number;
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
