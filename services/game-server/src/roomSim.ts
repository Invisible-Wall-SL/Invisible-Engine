import {
	BOT_PREFIX,
	botInput,
	characterBody,
	cleanName,
	createBot,
	createBotNamer,
	createRng,
	createOnlineRules,
	facingOf,
	generatedOnlineGame,
	nameKey,
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
import type { ArcadeBrain, ArcadeOnlineCharacter, OnlineGame } from 'game-config';

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
 * hold (stunned, out; a module's grounded, hooked) still has its inputs taken and acknowledged —
 * and passed to the rules, so a grounded salmon can jump — but stands still for them, as a device
 * told it is held predicts. A respawn moves a body with no input: the device reconciles it. A
 * module may STEER a free player's input (a leaping salmon carries its leap's move while the stick
 * rests: `engine-mechanics` `carriedInput`); the room sends what it carries (`air`, `carryX`,
 * `carryY`), so a predicting device steps the same input.
 *
 * BOTS (P10.16, §7) fill the room to `online.bots.fillTo` while anyone is in it. A bot is a player
 * (id `bot:<n>`, `bot: true`) whose input each step comes from its brain (`engine-mechanics`
 * `botInput`) instead of a device; from there it is stepped and ruled exactly as a device's player.
 * It aims a line's cast only at a player a person in its place could aim at: one the rules say it
 * sees (`rules.sees`) inside the `online.nearby` box a device there would be sent, and as well as
 * the rules say a person would (`rules.botAim`: a reaction time, a long cast falling short).
 * A joining player takes a bot's place — a bot of its character when that character has no place
 * left, else the newest — so the room never goes over its size; a leave lets a bot back in.
 *
 * BOTS BY SHARES (`online.bots.counts`, `game-config` `botShareCounts`): every place of the room
 * belongs to a class, `counts[class]` of them, and while a person is in the room it is exactly
 * full: each class has `max(0, counts[class] − its people)` bots, a dropped person whose place is
 * held counting as a person. With no person the mix would be exactly `counts`; a room nobody is in
 * has no bots. So:
 *  - a person joining class C takes the place of the newest bot of C;
 *  - C has no bot left (its places are all people's, or it has no share) ⇒ the join is refused
 *    (`no place left for C`); a join that names no class gets the first class, in
 *    `online.characters` order, with a place a person has not taken;
 *  - every place is a person's ⇒ `the room is full`;
 *  - a person leaving, or respawning as another class, lets a bot of the class it left back in
 *    (the respawn takes the newest bot's place in the class it picked, or is refused);
 *  - bots are let in one at a time, each of the class furthest below its count (a tie: the
 *    earlier in `bots.characters`), so the classes are spread through the room's order;
 *  - a bot starts at a place of its class: the class's `spawns` taken in turn (at random with
 *    `randomSpawn`), else `bots.spawns` in turn, else `online.spawn`.
 * A config that lists its bots by count is filled as it always was, by the paragraph above.
 *
 * RESPAWN (`rules.respawn: 'manual'`): a caught person waits until an input carries `respawn`, the
 * character it picked (`1 +` its index in `online.characters`). It comes back as that character,
 * at that character's spawn, if the character has a place (its own always has), taking a bot's place
 * when only bots fill it; else it stays out and is told (`respawnRefused`).
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
export const CREDIT_SECONDS = 0.5;

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
	/** Where it (re)spawns, unless its character spawns at random (`randomSpawn`). */
	home: { x: number; y: number };
};

export type JoinOptions = {
	name?: unknown;
	character?: unknown;
	/** It won the last game it played: only the server says so (`arcadeRoom.ts`' winner's pass). */
	wonLast?: boolean;
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
	join(id: string, options: JoinOptions): SimPlayer;
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
		online.characters.map((c) => [
			c.id,
			onlineLevel(game.zones, online.rules.zones, c.id, field, online.slide),
		]),
	);
	const atRest = { ...ctx, subSteps: 1, subDt: 0 };
	/** The room's draws of a place for a character that spawns at random (`randomSpawn`). */
	const spawnRng = createRng(`${seed}:spawns`);
	const spawn = (player: RulesPlayer) => {
		const { character, home } = player as SimPlayer;
		const homes = character.randomSpawn ? character.spawns : undefined;
		const at = homes?.length
			? homes[Math.floor(spawnRng() * homes.length)]
			: (home ?? online.spawn);
		player.body.x = at.x;
		player.body.y = at.y;
		// A spawn outside the field is pulled inside at once, as every later step would.
		stepPlayer(player.body, undefined, 0, atRest, field);
	};
	const rules = createOnlineRules(game, { spawn, seed });

	const countOf = (characterId: string) =>
		[...players.values()].filter((p) => p.character.id === characterId).length;
	const hasPlace = (c: ArcadeOnlineCharacter) => c.max === undefined || countOf(c.id) < c.max;

	/** By shares: each class's places in the room; `undefined` for bots by count. */
	const places = online.bots.counts;
	/** By shares: the classes bots play, in `bots.characters` order, each with its brain. */
	const shareClasses = places
		? online.bots.characters.flatMap((entry, i, all) => {
				const character = online.characters.find((c) => c.id === entry.character);
				const brain = game.brains[entry.brain];
				const first = all.findIndex((e) => e.character === entry.character) === i;
				return character && brain && first && places[character.id] ? [{ character, brain }] : [];
			})
		: [];
	const peopleOf = (characterId: string) =>
		[...players.values()].filter((p) => !p.bot && p.character.id === characterId).length;
	/** By shares: whether a place of `c` is not a person's (a bot holds it, or nobody yet). */
	const openTo = (c: ArcadeOnlineCharacter) => peopleOf(c.id) < (places?.[c.id] ?? 0);

	/** The newest bot, of `characterId` when one is named. */
	const newestBot = (characterId?: string) =>
		[...bots.keys()]
			.reverse()
			.find((id) => !characterId || players.get(id)?.character.id === characterId);

	/** Each class's bot names, from every bots entry that plays it (`bots.characters[].names`). */
	const namesByClass: Record<string, string[]> = {};
	for (const entry of online.bots.characters)
		if (entry.names?.length) (namesByClass[entry.character] ??= []).push(...entry.names);
	const namer = createBotNamer(namesByClass, seed);
	/** Every name in the room, as {@link nameKey}s. */
	const takenNames = () => new Set([...players.values()].map((p) => nameKey(p.name)));

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
		if (places) {
			const named = !(asked === undefined || asked === null || asked === '');
			character = named
				? online.characters.find((c) => c.id === asked)
				: online.characters.find(openTo);
			if (named && !character) throw new RoomRefusal('unknown character');
			if (humans() >= online.maxPlayers || !character) throw new RoomRefusal('the room is full');
			if (!openTo(character)) throw new RoomRefusal(`no place left for ${character.id}`);
			return { character, evict: newestBot(character.id) };
		}
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

	/** A respawn took a bot's place this step: the room is filled again after it. */
	let refill = false;

	/** The next of a character's spawns for a person (its join or its respawn). */
	const homeOf = (character: ArcadeOnlineCharacter) => {
		const homes = character.spawns;
		const n = joins.get(character.id) ?? 0;
		joins.set(character.id, n + 1);
		return homes?.length ? homes[n % homes.length] : online.spawn;
	};

	/** A caught person's Respawn as `online.characters[pick - 1]` (none such: as it was). */
	const respawnAs = (player: SimPlayer, pick: number, stamp: number) => {
		const character = online.characters[pick - 1] ?? player.character;
		if (places && character.id !== player.character.id) {
			if (!openTo(character)) {
				rules.refused(player);
				return;
			}
			const evict = newestBot(character.id);
			if (evict) removeBot(evict);
			refill = true;
		} else if (character.id !== player.character.id && !hasPlace(character)) {
			const evict = newestBot(character.id);
			if (!evict) {
				rules.refused(player);
				return;
			}
			removeBot(evict);
			refill = true;
		}
		if (character.id !== player.character.id) {
			player.character = character;
			player.body = characterBody(player.id, game.bodies[character.body], player.body);
		}
		player.home = homeOf(character);
		rules.respawned(player, stamp);
	};

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

	const addBot = (
		character: ArcadeOnlineCharacter,
		brain: ArcadeBrain,
		n: number,
		home: { x: number; y: number },
	) => {
		const id = `${BOT_PREFIX}${n + 1}`;
		const name = namer.next(character.id, takenNames()) ?? `Bot ${n + 1}`;
		const player = addPlayer(id, name, character, home, true);
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
	};

	/** By shares: bots made so far, by class: the next takes the next of its class's spawns. */
	const botTurns = new Map<string, number>();

	/** By shares: every class brought up to its places, one bot at a time, each of the class
	 *  furthest below its count. A person's join or respawn has already sent away the bot whose
	 *  place it took, so no class is ever over. */
	const fillShares = (counts: Record<string, number>) => {
		for (;;) {
			let next: (typeof shareClasses)[number] | undefined;
			let least = 1;
			for (const entry of shareClasses) {
				const held = countOf(entry.character.id) / counts[entry.character.id];
				if (held < least) {
					least = held;
					next = entry;
				}
			}
			if (!next) return;
			const { character, brain } = next;
			const n = botsMade++;
			const turn = botTurns.get(character.id) ?? 0;
			botTurns.set(character.id, turn + 1);
			const { spawns } = online.bots;
			const home = character.spawns?.length
				? character.spawns[turn % character.spawns.length]
				: spawns.length
					? spawns[n % spawns.length]
					: online.spawn;
			addBot(character, brain, n, home);
		}
	};

	/** Bring the room up to `fillTo` with bots while a person is in it; with nobody, send them away. */
	const fill = () => {
		if (!humans()) {
			for (const id of [...bots.keys()]) removeBot(id);
			return;
		}
		if (places) return fillShares(places);
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
			addBot(character, brain, n, spawns.length ? spawns[n % spawns.length] : online.spawn);
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
			const player = addPlayer(
				id,
				cleanName(options.name) || 'Player',
				character,
				homeOf(character),
				false,
			);
			if (options.wonLast === true) player.wonLast = true;
			// A person keeps the name it typed: a bot that holds it takes another of its class's.
			for (const other of players.values()) {
				if (!other.bot || nameKey(other.name) !== nameKey(player.name)) continue;
				const name = namer.next(other.character.id, takenNames());
				if (name) other.name = name;
			}
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
								sees: rules.sees,
								nearby: online.nearby,
								aim: rules.botAim,
								play: rules.botPlay,
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
					// The Respawn is this input: it comes back standing, and moves from the next.
					if (input.respawn && !player.bot && rules.awaitsRespawn(player)) {
						respawnAs(player, input.respawn, stamp);
						stepPlayer(player.body, undefined, player.character.speed, ctx, field);
						player.moving = false;
						continue;
					}
					if (rules.holds(player)) {
						stepPlayer(player.body, undefined, player.character.speed, ctx, field);
						player.moving = false;
						// A held player's input still reaches a rules module (a jump off a sandbank).
						rules.applied(player, input, players.values(), stamp);
						continue;
					}
					const level = rules.level(player, levels.get(player.character.id));
					const moved = rules.steer(player, input);
					stepPlayer(player.body, moved, player.character.speed, ctx, field, level);
					player.facing = facingOf(moved, player.facing);
					player.moving = moved.moveX !== 0 || moved.moveY !== 0;
					rules.applied(player, input, players.values(), stamp);
				}
			}
			steps = stamp;
			if (refill) {
				refill = false;
				fill();
			}
			return rules.afterStep(players.values(), stamp);
		},
	};
}
