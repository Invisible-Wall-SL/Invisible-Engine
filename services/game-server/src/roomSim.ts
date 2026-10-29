import {
	BOT_PREFIX,
	botInput,
	characterBody,
	cleanName,
	createBot,
	createOnlineRules,
	facingOf,
	generatedOnlineGame,
	onlineLevel,
	stepContext,
	stepPlayer,
	type OnlineBot,
	type OnlineEvent,
	type OnlineInput,
	type OnlineLevel,
	type OnlineRules,
	type RulesPlayer,
	type StepContext,
} from 'engine-mechanics';
import type { ArcadeOnlineCharacter, OnlineGame } from 'game-config';

/**
 * THE ROOM, WITHOUT THE NETWORK (`docs/design/realtime-multiplayer.md` §6, §8, §11): who is in it,
 * what each is, and one fixed step of everyone. `arcadeRoom.ts` runs it inside Colyseus; the
 * `check:room-sim` gate runs this very code headless for ten thousand steps.
 *
 * The room owns every body. A step takes each connected player's next inputs from the caller's
 * buffer, in `seq` order — one, or more while a backlog is draining and the player has credit
 * ({@link inputsThisStep}) — and moves the player once per input with `engine-mechanics`
 * `stepPlayer`, the function a predicting device runs. A player with no input this step, or one
 * that dropped and has not rejoined, stands still for the step. Bodies have no momentum (a step
 * with no input sets the velocity to 0), so a body is always the fold of `stepPlayer` over the
 * inputs applied — and nothing a device sends can place one or move it faster.
 *
 * THE RULES (P10.15) are the game's data, run by `engine-mechanics` `createOnlineRules`: a level's
 * currents push a player inside `stepPlayer` (so a device predicts them), and after each applied
 * input and each step the rules decide hits, statuses, the goal and the round. A player the rules
 * hold (stunned, out) still has its inputs taken and acknowledged, but stands still for them, as a
 * device told it is held predicts. A respawn moves a body with no input: the device reconciles it.
 *
 * BOTS (P10.16, §7) fill the room to `online.bots.fillTo` while anyone is in it. A bot is a player
 * (id `bot:<n>`, `bot: true`) whose input each step comes from its brain (`engine-mechanics`
 * `botInput`) instead of a device; from there it is stepped and ruled exactly as a device's player.
 * A joining player takes a bot's place — a bot of its character when that character has no place
 * left, else the newest — so the room never goes over its size; a leave lets a bot back in.
 */

/** Inputs a step leaves waiting (a cushion against jitter), and the most it applies at once. */
const KEEP_WAITING = 1;
const MOST_PER_STEP = 2;

/**
 * How many of a player's `waiting` inputs this step applies: one, or more while more than
 * {@link KEEP_WAITING} wait — but extra inputs only up to the player's `credit`, the steps it stood
 * still for want of an input. A device sends one per step, so a stall's burst would otherwise sit in
 * the buffer for good as latency; and without the credit a device could send two a step and move
 * twice as fast. With it, a player never applies more inputs than steps have passed.
 */
export const inputsThisStep = (waiting: number, credit: number): number =>
	Math.min(MOST_PER_STEP, 1 + Math.max(0, credit), Math.max(1, waiting - KEEP_WAITING));

/** The most catch-up a player can bank, in seconds: a stall that long drains; spending it is a dash
 *  of at most {@link MOST_PER_STEP}× speed for as long. */
const CREDIT_SECONDS = 0.5;

export type SimPlayer = RulesPlayer & {
	name: string;
	character: ArcadeOnlineCharacter;
	facing: number;
	moving: boolean;
	connected: boolean;
	/** The `seq` of the newest input applied; 0 before the first. */
	ack: number;
	/** Steps it stood still for want of an input, not yet made up ({@link inputsThisStep}). */
	credit: number;
	/** Where it (re)spawns. */
	home: { x: number; y: number };
};

export class RoomRefusal extends Error {}

export type RoomSim = {
	/** The game as this room plays it: with a field of its own when its config names a generator. */
	readonly game: OnlineGame;
	/** The room's seed: its bots' brains and its generated field, so a room replays from it. */
	readonly seed: number;
	readonly ctx: StepContext;
	readonly players: ReadonlyMap<string, SimPlayer>;
	readonly steps: number;
	readonly rules: OnlineRules;
	/** Add a player, or throw {@link RoomRefusal}: the room is full, or the character asked for is
	 *  unknown or has no place left. No character ⇒ the first with a place. */
	join(id: string, options: { name?: unknown; character?: unknown }): SimPlayer;
	/** Hold a dropped player's place: it stays where it is until it rejoins or leaves. */
	drop(id: string): void;
	rejoin(id: string): void;
	leave(id: string): void;
	/** One fixed step. `take(id, credit)` hands over the player's inputs for it, oldest first (none
	 *  = rest): at most {@link inputsThisStep} of what waits. Returns what happened in it. */
	step(take: (id: string, credit: number) => readonly OnlineInput[]): OnlineEvent[];
	/** What happened since the last step (joins and leaves). */
	events(): OnlineEvent[];
};

export type RoomSimOptions = {
	/** Seeds the bots' brains and a generated field (`engine-mechanics` `generatedOnlineGame`), so a
	 *  room replays exactly. Default: a random seed. */
	seed?: number;
};

export function createRoomSim(authored: OnlineGame, options: RoomSimOptions = {}): RoomSim {
	const seed = options.seed ?? Math.floor(Math.random() * 0x7fffffff);
	const { game } = generatedOnlineGame(authored, seed);
	const { online, field } = game;
	const bots = new Map<string, OnlineBot>();
	let botsMade = 0;
	/** People let in so far, by character: the next takes the next of its character's spawns. */
	const joins = new Map<string, number>();
	const ctx = stepContext(online.tickHz, online.subSteps);
	const creditMax = Math.ceil(online.tickHz * CREDIT_SECONDS);
	const players = new Map<string, SimPlayer>();
	let steps = 0;
	const levels = new Map<string, OnlineLevel>(
		online.characters.map((c) => [c.id, onlineLevel(game.zones, online.rules.zones, c.id, field)]),
	);
	const atRest = { ...ctx, subSteps: 1, subDt: 0 };
	const spawn = (player: RulesPlayer) => {
		const home = (player as SimPlayer).home ?? online.spawn;
		player.body.x = home.x;
		player.body.y = home.y;
		// A spawn outside the field is pulled inside at once, as every later step would.
		stepPlayer(player.body, undefined, 0, atRest, field);
	};
	const rules = createOnlineRules(game, { spawn });

	const countOf = (characterId: string) =>
		[...players.values()].filter((p) => p.character.id === characterId).length;
	const hasPlace = (c: ArcadeOnlineCharacter) => c.max === undefined || countOf(c.id) < c.max;

	/** The newest bot, of `characterId` when one is named. */
	const newestBot = (characterId?: string) =>
		[...bots.keys()]
			.reverse()
			.find((id) => !characterId || players.get(id)?.character.id === characterId);

	const removeBot = (id: string) => {
		bots.delete(id);
		if (players.delete(id)) rules.left(id);
	};

	/**
	 * The character a joining player gets and the one bot, if any, it takes the place of — decided
	 * before anything changes, so a refused join changes nothing. A bot of the asked character goes
	 * when only bots hold that character's places; else, in a full room, the newest bot.
	 */
	const plan = (asked: unknown): { character: ArcadeOnlineCharacter; evict?: string } => {
		let character: ArcadeOnlineCharacter | undefined;
		let evict: string | undefined;
		if (asked === undefined || asked === null || asked === '') {
			character = online.characters.find(hasPlace);
			if (!character) {
				character = online.characters.find((c) => newestBot(c.id));
				if (!character) throw new RoomRefusal('every character is taken');
				evict = newestBot(character.id);
			}
		} else {
			character = online.characters.find((c) => c.id === asked);
			if (!character) throw new RoomRefusal('unknown character');
			if (!hasPlace(character)) {
				evict = newestBot(character.id);
				if (!evict) throw new RoomRefusal(`no place left for ${character.id}`);
			}
		}
		if (!evict && players.size >= online.maxPlayers) {
			evict = newestBot();
			if (!evict) throw new RoomRefusal('the room is full');
		}
		return { character, evict };
	};

	const humans = () => players.size - bots.size;

	const addPlayer = (
		id: string,
		name: string,
		character: ArcadeOnlineCharacter,
		home: { x: number; y: number },
		bot: boolean,
	): SimPlayer => {
		const player: SimPlayer = {
			id,
			name,
			character,
			body: characterBody(id, game.bodies[character.body], home),
			facing: 0,
			moving: false,
			connected: true,
			ack: 0,
			credit: 0,
			home,
			score: 0,
			status: 0,
			until: 0,
			safeUntil: 0,
			mark: false,
			memo: {},
			cooldowns: {},
			...(bot ? { bot: true } : {}),
		};
		spawn(player);
		players.set(id, player);
		rules.joined(player, players.values(), steps);
		return player;
	};

	/** Bring the room up to `fillTo` with bots while a person is in it; with nobody, send them away. */
	const fill = () => {
		if (!humans()) {
			for (const id of [...bots.keys()]) removeBot(id);
			return;
		}
		const { fillTo, characters, spawns } = online.bots;
		const limit = Math.min(fillTo, online.maxPlayers);
		while (bots.size > 0 && players.size > limit) removeBot(newestBot()!);
		for (let tries = 0; players.size < limit && tries < characters.length;) {
			const entry = characters[botsMade % characters.length];
			const character = online.characters.find((c) => c.id === entry.character);
			const brain = game.brains[entry.brain];
			if (!character || !brain || !hasPlace(character)) {
				botsMade += 1;
				tries += 1;
				continue;
			}
			tries = 0;
			const n = botsMade++;
			const id = `${BOT_PREFIX}${n + 1}`;
			const home = spawns.length ? spawns[n % spawns.length] : online.spawn;
			const player = addPlayer(id, `Bot ${n + 1}`, character, home, true);
			bots.set(
				id,
				createBot({
					brain,
					seed: (seed + n * 0x9e3779b1) >>> 0,
					at: { x: player.body.x, y: player.body.y },
					abilities: online.rules.abilities,
					character: character.id,
				}),
			);
		}
	};

	return {
		game,
		seed,
		ctx,
		players,
		get steps() {
			return steps;
		},
		rules,
		join(id, options) {
			if (players.has(id)) throw new RoomRefusal('already in the room');
			const { character, evict } = plan(options.character);
			if (evict) removeBot(evict);
			const homes = character.spawns;
			const n = joins.get(character.id) ?? 0;
			joins.set(character.id, n + 1);
			const player = addPlayer(
				id,
				cleanName(options.name) || 'Player',
				character,
				homes?.length ? homes[n % homes.length] : online.spawn,
				false,
			);
			fill();
			return player;
		},
		drop(id) {
			const player = players.get(id);
			if (player) {
				player.connected = false;
				player.moving = false;
			}
		},
		rejoin(id) {
			const player = players.get(id);
			if (player) player.connected = true;
		},
		leave(id) {
			if (bots.has(id)) return;
			if (players.delete(id)) rules.left(id);
			fill();
		},
		events: () => rules.take(),
		step(take) {
			const stamp = steps + 1;
			for (const player of players.values()) {
				if (!player.connected) {
					stepPlayer(player.body, undefined, player.character.speed, ctx, field);
					continue;
				}
				const bot = bots.get(player.id);
				const inputs = bot
					? [
							botInput(bot, player, players.values(), {
								dt: ctx.dt,
								speed: player.character.speed,
								field,
								view: steps,
							}),
						]
					: take(player.id, player.credit);
				if (!inputs.length) {
					stepPlayer(player.body, undefined, player.character.speed, ctx, field);
					player.moving = false;
					player.credit = Math.min(creditMax, player.credit + 1);
				} else player.credit = Math.max(0, player.credit - (inputs.length - 1));
				for (const input of inputs) {
					player.ack = input.seq;
					if (rules.holds(player)) {
						stepPlayer(player.body, undefined, player.character.speed, ctx, field);
						player.moving = false;
						continue;
					}
					const level = levels.get(player.character.id);
					stepPlayer(player.body, input, player.character.speed, ctx, field, level);
					player.facing = facingOf(input, player.facing);
					player.moving = input.moveX !== 0 || input.moveY !== 0;
					rules.applied(player, input, players.values(), stamp);
				}
			}
			steps = stamp;
			return rules.afterStep(players.values(), stamp);
		},
	};
}
