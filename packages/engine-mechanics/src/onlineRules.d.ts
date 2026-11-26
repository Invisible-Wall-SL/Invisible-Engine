/**
 * Types for an online room's rules (`onlineRules.js`, `docs/design/realtime-multiplayer.md` §4).
 * The behaviour is pinned by `scripts/check-online-rules.mjs`.
 */

import type { Body } from './motion';
import type { OnlineInput, OnlineLevel } from './online';

import type { STATUS } from './abilities';
import type { BotAim, BotPlay } from './onlineBots';

export { GRACE_MS, STATUS } from './abilities';
export const REWIND_MS: 250;
export const ONLINE_EVENT: 'event';

export type OnlinePhase = 'waiting' | 'running' | 'ended';

/** A player as the rules see it: the room's own record, mutated in place. */
export type RulesPlayer = {
	id: string;
	/** Its name, for a `gameWon`'s `winnerName`. */
	name?: string;
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
	/** How high a rules module has lifted it off the ground, px (a salmon's leap); absent ⇒ 0. */
	z?: number;
	/** Inputs left for which it carries `carryX` / `carryY` (`online.js` `carriedInput`: a
	 *  salmon's leap); absent ⇒ none. */
	air?: number;
	carryX?: number;
	carryY?: number;
	/** A rules module's own notes on the player. */
	memo: Record<string, number>;
	/** Button → the stamp it can be used again at. */
	cooldowns: Record<string, number>;
	/** A bot the server plays (P10.16). */
	bot?: boolean;
	/** It won the last game it played (only the server says so: Salmons' golden salmon). */
	wonLast?: boolean;
	/** Ability key → whether its button was down when last asked (`abilities.js`). */
	down?: Record<string, boolean>;
	/** Its line (Salmons' fisherman): out while `lineActive` is 1, the bobber at `lineX`, `lineY`. */
	lineX?: number;
	lineY?: number;
	lineActive?: number;
	/** The player holding it in its hands (a `hook` ability's `carry`: Salmons' caught salmon);
	 *  '' or absent ⇒ nobody. */
	heldBy?: string;
};

export type OnlineEvent =
	| { type: 'joined' | 'left'; id: string }
	| { type: 'ability'; by: string; button: string }
	| { type: 'hit'; by: string; target: string; effect: string }
	/** `byName`: the catcher's name (a far catcher is not in a nearby device's view). */
	| { type: 'caught'; by: string; target: string; effect: string; byName: string }
	| { type: 'roundStart'; round: number }
	| { type: 'roundEnd'; round: number; winner: string }
	| { type: 'gameWon'; winner: string; winnerName: string }
	| { type: 'respawned'; id: string; character: string }
	| { type: 'respawnRefused'; id: string }
	/** Sent by the game server to the winner's device alone (`arcadeRoom.ts`): its winner's pass. */
	| { type: 'winnerPass'; pass: string }
	| { type: 'lobby'; id: string }
	| { type: 'countdown'; seconds: number }
	| { type: 'climbed' | 'grounded'; id: string; zone: string }
	| { type: 'jumped' | 'golden'; id: string }
	| { type: 'hooked' | 'escaped'; by: string; target: string }
	/** A `hook` ability's `carry`: its line landed `target` into `by`'s hands. */
	| { type: 'held'; by: string; target: string }
	/** `by` threw `target` at (`x`, `y`), field px: where it will land. */
	| { type: 'thrown'; by: string; target: string; x: number; y: number }
	/** A carried `target` came down at (`x`, `y`) and is out (its `caught` follows); `dropped`: it
	 *  was not thrown (held too long, or its holder dropped, was caught or left). */
	| { type: 'landed'; by: string; target: string; x: number; y: number; dropped?: boolean };

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

/** An ability as a module's `cast` gets it: `hold` is its `ms` in steps. */
export type RulesAbility = {
	score: number;
	hold: number;
	reach: number;
	button: string;
	targets: readonly string[];
	/** Present ⇒ a target its line lands is held, then thrown (`game-config`
	 *  `ResolvedArcadeCarry`). */
	carry?: { holdMs: number; throwPx: number; flightMs: number; walk: boolean };
};

/** What a rules module's hooks may do to the room (P11.3). */
export type ModuleApi = {
	STATUS: typeof STATUS;
	/** Free a player, safe from hits for {@link GRACE_MS}. */
	free(player: RulesPlayer, stamp: number): void;
	/** Free a player with no grace. */
	release(player: RulesPlayer): void;
	score(player: RulesPlayer, points: number): void;
	worth(player: RulesPlayer, points: number): number;
	/** Put a player out, caught: until it presses Respawn (`respawn: 'manual'`), else for `hold`. */
	out(player: RulesPlayer, stamp: number, hold: number): void;
};

/** A rules module's hooks, every one optional (`ONLINE_RULES_MODULES`). */
export type RulesHooks = {
	step?(world: RulesWorld): void;
	/** Its world has no players: an input is the player's own. */
	input?(player: RulesPlayer, input: OnlineInput, world: Omit<RulesWorld, 'players'>): void;
	/** A `hook` ability cast at `aim`; true: it took the cast (its cooldown starts). */
	cast?(
		user: RulesPlayer,
		ability: RulesAbility,
		aim: { x: number; y: number },
		world: RulesWorld,
	): boolean;
	/** Whether `player` sees the world point `at` (a bot aims a `hook` ability only at what it
	 *  sees). */
	sees?(player: RulesPlayer, at: { x: number; y: number }): boolean;
	/** A person's limits for a bot's abilities (a reaction time, a cast's error). */
	botAim?: BotAim;
	/** Its own play of a bot (a move and buttons), or nothing for one it leaves to its brain. */
	botPlay?: BotPlay;
	worth?(player: RulesPlayer, points: number): number;
	reset?(world: RulesWorld): void;
	/** Whether it holds a free player still (stepped with no input, as a held status is). Asked,
	 *  like `level`, only while a round runs. */
	holds?(player: RulesPlayer): boolean;
	/** The level the room steps `player` on, in place of its character's. */
	level?(player: RulesPlayer, level: OnlineLevel | undefined): OnlineLevel | undefined;
	/** The input the room steps a free player it does not hold with, in place of `input`. */
	steer?(player: RulesPlayer, input: OnlineInput): OnlineInput;
	/** The marks it left on the field (Salmons' bloodstains). */
	stains?(): RoomStains;
};

/** Marks a rules module left on the field (field px), the newest last, and how many it ever left:
 *  a room sends a device only the ones it has not sent yet. */
export type RoomStains = {
	readonly list: readonly { readonly x: number; readonly y: number }[];
	readonly made: number;
};

export type RulesModule = RulesHooks | { create(game: RulesGame, api: ModuleApi): RulesHooks };

export const ONLINE_RULES_MODULES: Readonly<Record<string, RulesModule>>;

export type OnlineRules = {
	readonly phase: OnlinePhase;
	readonly round: number;
	/** The stamp the phase ends at; 0 = never. A lobby's, from its first person: when round 1
	 *  starts at the latest, then the countdown's end. */
	readonly endsAt: number;
	readonly winner: string;
	readonly winnerName: string;
	/** Whether a caught player waits for its Respawn (`respawn: 'manual'`). */
	awaitsRespawn(player: RulesPlayer): boolean;
	/** Whether a person may change the class it plays in place: a game with a lobby, until its
	 *  first round starts. */
	readonly picking: boolean;
	/** Back at its spawn, free, as the character the room gave it (`respawned`). */
	respawned(player: RulesPlayer, stamp: number): void;
	/** Tell its device the Respawn, or the lobby's pick, was refused (`respawnRefused`). */
	refused(player: RulesPlayer): void;
	/** The marks the rules module left on the field; none without one that leaves them. */
	readonly stains: RoomStains;
	joined(player: RulesPlayer, players: Iterable<RulesPlayer>, stamp: number): void;
	left(id: string): void;
	holds(player: RulesPlayer): boolean;
	level(player: RulesPlayer, level: OnlineLevel | undefined): OnlineLevel | undefined;
	steer(player: RulesPlayer, input: OnlineInput): OnlineInput;
	/** Whether `player` sees the world point `at`: the module's answer, true with none. */
	sees(player: RulesPlayer, at: { x: number; y: number }): boolean;
	/** A person's limits for a bot's abilities, as the module says; none with none. */
	readonly botAim?: BotAim;
	/** The module's own play of a bot (`botInput`'s `play`); none with none. */
	readonly botPlay?: BotPlay;
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
				ahead?: number;
				onPress?: boolean;
			}[];
			round: { seconds?: number; nextRoundSeconds: number; goalScore: number; endsGame?: true };
			respawn?: 'auto' | 'manual';
			module?: string;
		};
	};
};

export function createOnlineRules(
	game: RulesGame,
	options: { spawn(player: RulesPlayer): void; seed?: number },
): OnlineRules;
