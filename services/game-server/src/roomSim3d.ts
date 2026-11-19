import { cleanName, stepContext, type StepContext } from 'engine-mechanics';
import {
	createBody3d,
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
	levelOf3d,
	motionFor3d,
	respawnOnFall3d,
	stepPlayer3d,
	type Bot3d,
	type Input3d,
	type World3d,
} from 'engine-mechanics/src/online3d.js';
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
 * predicting device runs. A 3D body has momentum, so a player with no input this step is NOT
 * stepped while its body is fewer than `CREDIT_SECONDS` of steps behind the room's clock (its
 * `credit`): its body waits where it is, and is exactly the fold of `stepPlayer3d` over the inputs
 * applied — whatever the jitter, which is what lets a device predict it to the bit. A body that far
 * behind belongs to a device that stopped sending (a backgrounded tab, a stalled link) or sends too
 * few inputs to keep up (a slow clock, a hand-made client hovering in slow motion), so it — and a
 * dropped one, every step — is stepped by a resting input (no move, no buttons, its own yaw) that
 * leaves its `ack` alone: it falls and lands for everyone else, and no body is ever more than
 * `CREDIT_SECONDS` behind the room. Its device (`createPredictor3d`) takes those resting steps in
 * one correction from the whole body the room sends it (`arcadeRoom3d.ts`). A player that has
 * never sent an input (still loading) waits at its home, which is where its device's predictor
 * starts.
 *
 * Each applied step raises its signals (`motion3d` `trackStep3d`: jumped, landed, bounced, zone
 * edges, fell) as events naming the player. A body below the death plane is back at its home at
 * rest on that step (`respawnOnFall3d`, a `respawned` event) — part of the fold, so a device
 * predicts it too. Crash
 * rules, combat and the lobby are later steps; until then a room is `waiting` with nobody in it and
 * `running` with anybody.
 *
 * Bots fill the room to `online.bots.fillTo` while a person is in it, exactly as in 2D: a bot is a
 * player (`bot:<n>`) whose input comes from its brain (`engine-mechanics` `botInput3d`, the brain
 * seeing the room on the x/z plane), stepped like any other; a joining person takes a bot's place.
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
	/** Steps its body is behind the room's clock: steps it waited for want of an input, not yet
	 *  made up. At `CREDIT_SECONDS` of them a step with no input is a resting one. */
	credit: number;
	/** Resting steps it has been given. */
	rested: number;
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
	readonly players: ReadonlyMap<string, SimPlayer3d>;
	readonly steps: number;
	/** `waiting` with no person in the room, else `running`. */
	readonly phase: 'waiting' | 'running';
	/** Add a player, or throw {@link RoomRefusal} (as `roomSim.ts`). */
	join(id: string, options: { name?: unknown; character?: unknown }): SimPlayer3d;
	drop(id: string): void;
	rejoin(id: string): void;
	leave(id: string): void;
	/**
	 * One fixed step; `take(id, credit)` hands over the player's inputs for it, oldest first. A
	 * `catchUp` step runs in a batch after another (the wall clock owed several): no input could
	 * have arrived since, so a player's silence is not counted toward resting it.
	 */
	step(
		take: (id: string, credit: number) => readonly Input3d[],
		options?: { catchUp?: boolean },
	): Online3dEvent[];
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
	const level = levelOf3d(world);
	const players = new Map<string, SimPlayer3d>();
	const bots = new Map<string, Bot3d>();
	let botsMade = 0;
	let placed = 0;
	let steps = 0;
	let pending: Online3dEvent[] = [];

	const countOf = (characterId: string) =>
		[...players.values()].filter((p) => p.character.id === characterId).length;
	const hasPlace = (c: ArcadeOnlineCharacter) => c.max === undefined || countOf(c.id) < c.max;
	const newestBot = (characterId?: string) =>
		[...bots.keys()]
			.reverse()
			.find((id) => !characterId || players.get(id)?.character.id === characterId);
	const humans = () => players.size - bots.size;

	const removeBot = (id: string) => {
		bots.delete(id);
		if (players.delete(id)) pending.push({ type: 'left', id });
	};

	/** `roomSim.ts`'s plan: the character a joining person gets and the bot it replaces, if any. */
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

	/** BOTY's rule: a new player joins the smaller team, red (0) on a tie. */
	const nextTeam = () => {
		let red = 0;
		let blue = 0;
		for (const p of players.values()) {
			if (p.team === 0) red += 1;
			else blue += 1;
		}
		return red <= blue ? 0 : 1;
	};

	const addPlayer = (
		id: string,
		name: string,
		character: ArcadeOnlineCharacter,
		bot: boolean,
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
			rested: 0,
			home,
			status: 0,
			team: nextTeam(),
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
		const { fillTo, characters } = online.bots;
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
			const player = addPlayer(id, `Bot ${n + 1}`, character, true);
			bots.set(id, createBot3d({ brain, seed: (seed + n * 0x9e3779b1) >>> 0, at: player.body }));
		}
	};

	/** One step of a player's body by `input`, its signals and a fall's respawn raised. */
	const advance = (player: SimPlayer3d, input: Input3d, events: Online3dEvent[]) => {
		const result = stepPlayer3d(player.body, input, level, player.spec, ctx.dt);
		player.anim = animBits3d(player.body, input, player.anim);
		const bot = bots.get(player.id);
		if (bot) bot.blocked = result.onWall;
		for (const signal of trackStep3d(player.tracker, player.body, result, level, player.spec))
			events.push({ ...signal, id: player.id });
		if (respawnOnFall3d(player.body, result, player.home))
			events.push({ type: 'respawned', id: player.id });
	};

	const apply = (player: SimPlayer3d, input: Input3d, events: Online3dEvent[]) => {
		player.ack = input.seq;
		advance(player, input, events);
	};

	const resting: Input3d = { seq: 0, moveX: 0, moveZ: 0, buttons: 0, yaw: 0, pitch: 0, view: 0 };
	/** A step for a player too far behind or dropped: at rest, facing its way, `ack` kept. */
	const idle = (player: SimPlayer3d, events: Online3dEvent[]) => {
		if (player.ack === 0) return;
		resting.seq = player.ack;
		resting.yaw = player.body.yaw;
		resting.view = steps;
		player.rested += 1;
		advance(player, resting, events);
	};

	return {
		game,
		world,
		level,
		seed,
		ctx,
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
			if (evict) removeBot(evict);
			const player = addPlayer(id, cleanName(options.name) || 'Player', character, false);
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
		step(take, { catchUp = false } = {}) {
			const events: Online3dEvent[] = [];
			for (const player of players.values()) {
				if (!player.connected) {
					idle(player, events);
					continue;
				}
				const bot = bots.get(player.id);
				const inputs = bot
					? [
							botInput3d(bot, player, players.values(), {
								dt: ctx.dt,
								spec: player.spec,
								view: steps,
							}),
						]
					: take(player.id, player.credit);
				if (!inputs.length) {
					if (player.ack === 0) continue;
					if (player.credit < creditMax) player.credit += 1;
					else if (!catchUp) idle(player, events);
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
