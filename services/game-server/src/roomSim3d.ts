import { cleanName, stepContext, type StepContext } from 'engine-mechanics';
import {
	createBody3d,
	createLevel3d,
	createTracker3d,
	trackStep3d,
	type Body3d,
	type Level3d,
	type Motion3dSpec,
	type Tracker3d,
} from 'engine-mechanics/src/motion3d.js';
import {
	BOT_PREFIX,
	animBits3d,
	botInput3d,
	createBot3d,
	motionFor3d,
	respawnOnFall3d,
	stepPlayer3d,
	type Bot3d,
	type Input3d,
	type World3d,
} from 'engine-mechanics/src/online3d.js';
import {
	createCrashBot3d,
	crashBotInput3d,
	crashOptionsFor,
	type CrashBot3d,
	type CrashPiece3d,
} from 'engine-mechanics/src/crashBots3d.js';
import { createNavGrid3d, type NavGrid3d } from 'engine-mechanics/src/nav3d.js';
import type { ArcadeOnlineCharacter, OnlineGame } from 'game-config';

import { CREDIT_SECONDS, RoomRefusal } from './roomSim.ts';

/**
 * THE 3D ROOM, WITHOUT THE NETWORK (`docs/design/3d/gameplay-evaluation.md` §2–§4): `roomSim.ts`
 * for a game with an `arcade.world3d` block. `arcadeRoom3d.ts` runs it inside Colyseus; the
 * `check:room-sim-3d` gate runs this very code headless.
 *
 * The room owns every body. A step takes each connected player's next inputs in `seq` order (one,
 * or two while a backlog drains and the player has credit — `roomSim.ts` `inputsThisStep`) and steps
 * its `motion3d` body once per input with `engine-mechanics` `stepPlayer3d`, the function a
 * predicting device runs. A 3D body has momentum, so a player with no input this step, or one that
 * dropped, is NOT stepped: its body waits where it is, and is always exactly the fold of
 * `stepPlayer3d` over the inputs applied — whatever the latency, which is what lets a device predict
 * it to the bit.
 *
 * Each applied step raises its signals (`motion3d` `trackStep3d`: jumped, landed, bounced, zone
 * edges, fell) as events naming the player. A body below the death plane is back at its home at
 * rest on that step (`respawnOnFall3d`, a `respawned` event) — part of the fold, so a device
 * predicts it too. Crash
 * rules, combat and the lobby are later steps; until then a room is `waiting` with nobody in it and
 * `running` with anybody.
 *
 * Bots fill the room to `online.bots.fillTo` seats while a person is in it, the teams kept even: a
 * bot is a player (`bot:<n>`) whose input comes from its brain, stepped like any other. A joining
 * person takes a bot's seat on the person's team (the team with fewer people); a person who leaves
 * (after the rejoin grace, `arcadeRoom3d.ts`) is replaced by a bot. A world with an
 * `arcade.world3d.bots.crash` block plays the Crash brain (`engine-mechanics` `crashBotInput3d` on
 * the level's nav graph, built once here); any other the plane brain (`botInput3d`).
 */

export type SimPlayer3d = {
	id: string;
	name: string;
	character: ArcadeOnlineCharacter;
	/** Its character's body tags (`arcade.bodies`), what a bot's brain chases or flees by. */
	tags: readonly string[];
	body: Body3d;
	spec: Readonly<Motion3dSpec>;
	connected: boolean;
	/** The `seq` of the newest input applied; 0 before the first. */
	ack: number;
	/** Steps it waited for want of an input, not yet made up. */
	credit: number;
	home: { x: number; y: number; z: number; yaw: number };
	/** `engine-mechanics` `STATUS`; always free until the rules hold anyone. */
	status: number;
	team: number;
	/** `ANIM3D` bits after its last applied input. */
	anim: number;
	tracker: Tracker3d;
	bot?: true;
};

export type Online3dEvent =
	| { type: 'joined' | 'left' | 'respawned'; id: string }
	| { type: 'jumped' | 'doubleJumped' | 'landed' | 'bounced' | 'fell'; id: string }
	| { type: 'enterZone' | 'leaveZone'; id: string; zone: number; kind: string };

export type RoomSim3d = {
	readonly game: OnlineGame;
	readonly world: World3d;
	readonly level: Level3d;
	readonly seed: number;
	readonly ctx: StepContext;
	/** The level's nav graph, when its bots play the Crash brain. */
	readonly nav: NavGrid3d | undefined;
	readonly players: ReadonlyMap<string, SimPlayer3d>;
	readonly steps: number;
	/** `waiting` with no person in the room, else `running`. */
	readonly phase: 'waiting' | 'running';
	/** Add a player, or throw {@link RoomRefusal} (as `roomSim.ts`). */
	join(id: string, options: { name?: unknown; character?: unknown }): SimPlayer3d;
	drop(id: string): void;
	rejoin(id: string): void;
	leave(id: string): void;
	/** One fixed step; `take(id, credit)` hands over the player's inputs for it, oldest first. */
	step(take: (id: string, credit: number) => readonly Input3d[]): Online3dEvent[];
	/** What happened since the last step (joins and leaves). */
	events(): Online3dEvent[];
};

export function createRoomSim3d(
	game: OnlineGame,
	world: World3d,
	options: { seed?: number } = {},
): RoomSim3d {
	const seed = options.seed ?? Math.floor(Math.random() * 0x7fffffff);
	const { online } = game;
	const ctx = stepContext(online.tickHz, online.subSteps);
	const creditMax = Math.ceil(online.tickHz * CREDIT_SECONDS);
	const level = createLevel3d(world.level);
	const players = new Map<string, SimPlayer3d>();
	const bots = new Map<string, Bot3d | CrashBot3d>();
	const crash = world.bots?.crash;
	const nav = crash ? createNavGrid3d(level, world.motion, world.bots?.nav) : undefined;
	const pitZone = level.zones.find((z) => z.kind === 'pit');
	const pit = pitZone
		? {
				x: (pitZone.minX + pitZone.maxX) / 2,
				y: pitZone.minY,
				z: (pitZone.minZ + pitZone.maxZ) / 2,
			}
		: null;
	const pieces: CrashPiece3d[] = [];
	let botsMade = 0;
	let placed = 0;
	let steps = 0;
	let pending: Online3dEvent[] = [];

	const countOf = (characterId: string) =>
		[...players.values()].filter((p) => p.character.id === characterId).length;
	const hasPlace = (c: ArcadeOnlineCharacter) => c.max === undefined || countOf(c.id) < c.max;
	const newestBot = (characterId?: string, team?: number) =>
		[...bots.keys()]
			.reverse()
			.find(
				(id) =>
					(!characterId || players.get(id)?.character.id === characterId) &&
					(team === undefined || players.get(id)?.team === team),
			);
	/** The newest bot, on `team` if it has one. */
	const newestBotOn = (team: number, characterId?: string) =>
		newestBot(characterId, team) ?? newestBot(characterId);
	const humans = () => players.size - bots.size;

	const removeBot = (id: string) => {
		bots.delete(id);
		if (players.delete(id)) pending.push({ type: 'left', id });
	};

	/** The team with fewer people on it (bots not counted), red (0) on a tie. */
	const personTeam = () => {
		let red = 0;
		let blue = 0;
		for (const p of players.values()) {
			if (p.bot) continue;
			if (p.team === 0) red += 1;
			else blue += 1;
		}
		return red <= blue ? 0 : 1;
	};

	/** `roomSim.ts`'s plan: the character a joining person gets and the bot it replaces, if any —
	 *  one on the person's team ({@link personTeam}) when there is one. */
	const plan = (asked: unknown): { character: ArcadeOnlineCharacter; evict?: string } => {
		const team = personTeam();
		let character: ArcadeOnlineCharacter | undefined;
		let evict: string | undefined;
		if (asked === undefined || asked === null || asked === '') {
			character = online.characters.find(hasPlace);
			if (!character) {
				character = online.characters.find((c) => newestBot(c.id));
				if (!character) throw new RoomRefusal('every character is taken');
				evict = newestBotOn(team, character.id);
			}
		} else {
			character = online.characters.find((c) => c.id === asked);
			if (!character) throw new RoomRefusal('unknown character');
			if (!hasPlace(character)) {
				evict = newestBotOn(team, character.id);
				if (!evict) throw new RoomRefusal(`no place left for ${character.id}`);
			}
		}
		if (!evict && (players.size >= online.maxPlayers || (bots.size && players.size >= seats()))) {
			evict = newestBotOn(team);
			if (!evict) throw new RoomRefusal('the room is full');
		}
		return { character, evict };
	};

	const teamSizes = () => {
		let red = 0;
		let blue = 0;
		for (const p of players.values()) {
			if (p.team === 0) red += 1;
			else blue += 1;
		}
		return [red, blue];
	};

	/** BOTY's rule (`CrashMatchController`): a new player joins the smaller team, red (0) on a tie. */
	const nextTeam = () => {
		const [red, blue] = teamSizes();
		return red <= blue ? 0 : 1;
	};

	/** The seats bots fill: `online.bots.fillTo`, no more than the room holds. */
	const seats = () => Math.min(online.bots.fillTo, online.maxPlayers);

	const addPlayer = (
		id: string,
		name: string,
		character: ArcadeOnlineCharacter,
		bot: boolean,
		team = nextTeam(),
	): SimPlayer3d => {
		const home = world.spawns[placed++ % world.spawns.length];
		const player: SimPlayer3d = {
			id,
			name,
			character,
			tags: game.bodies[character.body]?.tags ?? [],
			body: createBody3d(home),
			spec: motionFor3d(world, character.id),
			connected: true,
			ack: 0,
			credit: 0,
			home,
			status: 0,
			team,
			anim: 0,
			tracker: createTracker3d(),
			...(bot ? { bot: true as const } : {}),
		};
		players.set(id, player);
		pending.push({ type: 'joined', id });
		return player;
	};

	const fill = () => {
		if (!humans()) {
			for (const id of [...bots.keys()]) removeBot(id);
			return;
		}
		const { characters } = online.bots;
		const limit = seats();
		while (bots.size > 0 && players.size > limit) {
			const [red, blue] = teamSizes();
			removeBot(newestBotOn(red > blue ? 0 : 1)!);
		}
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
			const player = addPlayer(id, `Bot ${n + 1}`, character, true);
			const botSeed = (seed + n * 0x9e3779b1) >>> 0;
			bots.set(
				id,
				crash
					? createCrashBot3d({ seed: botSeed, options: crashOptionsFor(crash, character.id) })
					: createBot3d({ brain, seed: botSeed, at: player.body }),
			);
		}
	};

	const apply = (player: SimPlayer3d, input: Input3d, events: Online3dEvent[]) => {
		player.ack = input.seq;
		const result = stepPlayer3d(player.body, input, level, player.spec, ctx.dt);
		player.anim = animBits3d(player.body, input, player.anim);
		const bot = bots.get(player.id);
		if (bot) bot.blocked = result.onWall;
		for (const signal of trackStep3d(player.tracker, player.body, result, level, player.spec))
			events.push({ ...signal, id: player.id });
		if (respawnOnFall3d(player.body, result, player.home))
			events.push({ type: 'respawned', id: player.id });
	};

	const botStep = (bot: Bot3d | CrashBot3d, player: SimPlayer3d) =>
		'brain' in bot
			? botInput3d(bot, player, players.values(), { dt: ctx.dt, spec: player.spec, view: steps })
			: crashBotInput3d(
					bot,
					player,
					{ players: players.values(), pieces, pit },
					{ nav: nav!, level, dt: ctx.dt, spec: player.spec, view: steps },
				);

	return {
		game,
		world,
		level,
		seed,
		ctx,
		nav,
		players,
		get steps() {
			return steps;
		},
		get phase() {
			return humans() > 0 ? 'running' : 'waiting';
		},
		join(id, options) {
			if (players.has(id)) throw new RoomRefusal('already in the room');
			const { character, evict } = plan(options.character);
			const seat = evict ? players.get(evict)?.team : undefined;
			if (evict) removeBot(evict);
			const name = cleanName(options.name) || 'Player';
			const player = addPlayer(id, name, character, false, seat ?? nextTeam());
			fill();
			return player;
		},
		drop(id) {
			const player = players.get(id);
			if (player) player.connected = false;
		},
		rejoin(id) {
			const player = players.get(id);
			if (player) player.connected = true;
		},
		leave(id) {
			if (bots.has(id)) return;
			if (players.delete(id)) pending.push({ type: 'left', id });
			fill();
		},
		events() {
			const out = pending;
			pending = [];
			return out;
		},
		step(take) {
			const events: Online3dEvent[] = [];
			for (const player of players.values()) {
				if (!player.connected) continue;
				const bot = bots.get(player.id);
				const inputs = bot ? [botStep(bot, player)] : take(player.id, player.credit);
				if (!inputs.length) {
					player.credit = Math.min(creditMax, player.credit + 1);
					continue;
				}
				player.credit = Math.max(0, player.credit - (inputs.length - 1));
				for (const input of inputs) apply(player, input, events);
			}
			steps += 1;
			return events;
		},
	};
}
