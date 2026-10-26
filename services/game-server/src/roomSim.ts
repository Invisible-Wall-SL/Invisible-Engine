import {
	characterBody,
	cleanName,
	facingOf,
	stepContext,
	stepPlayer,
	type Body,
	type OnlineInput,
	type StepContext,
} from 'engine-mechanics';
import type { ArcadeOnlineCharacter, OnlineGame } from 'game-config';

/**
 * THE ROOM, WITHOUT THE NETWORK (`docs/design/realtime-multiplayer.md` §6, §8, §11): who is in it,
 * what each is, and one fixed step of everyone. `arcadeRoom.ts` runs it inside Colyseus; the
 * `check:room-sim` gate runs this very code headless for ten thousand steps.
 *
 * The room owns every body. A step takes each connected player's next inputs from the caller's
 * buffer, in `seq` order — one, or more while a backlog is draining ({@link inputsThisStep}) — and
 * moves the player once per input with `engine-mechanics` `stepPlayer`, the function a predicting
 * device runs. A player with no input this step, or one that dropped and has not rejoined, stands
 * still for the step. So a body is always the fold of `stepPlayer` over the inputs applied, and
 * nothing a device sends can place one.
 */

/** Inputs a step leaves waiting (a cushion against jitter), and the most it applies at once. */
const KEEP_WAITING = 1;
const MOST_PER_STEP = 4;

/**
 * How many of a player's `waiting` inputs this step applies: one, or more while more than
 * {@link KEEP_WAITING} wait, at most {@link MOST_PER_STEP}. A device sends one per step, so a
 * stall's burst would otherwise sit in the buffer for good as latency.
 */
export const inputsThisStep = (waiting: number): number =>
	Math.min(MOST_PER_STEP, Math.max(1, waiting - KEEP_WAITING));

export type SimPlayer = {
	id: string;
	name: string;
	character: ArcadeOnlineCharacter;
	/** Plain numbers, never the synced schema: the step reads and writes only this. */
	body: Body;
	facing: number;
	moving: boolean;
	connected: boolean;
	/** The `seq` of the newest input applied; 0 before the first. */
	ack: number;
};

export class RoomRefusal extends Error {}

export type RoomSim = {
	readonly game: OnlineGame;
	readonly ctx: StepContext;
	readonly players: ReadonlyMap<string, SimPlayer>;
	readonly steps: number;
	/** Add a player, or throw {@link RoomRefusal}: the room is full, or the character asked for is
	 *  unknown or has no place left. No character ⇒ the first with a place. */
	join(id: string, options: { name?: unknown; character?: unknown }): SimPlayer;
	/** Hold a dropped player's place: it stays where it is until it rejoins or leaves. */
	drop(id: string): void;
	rejoin(id: string): void;
	leave(id: string): void;
	/** One fixed step. `take(id)` hands over the player's inputs for it, oldest first (none = rest). */
	step(take: (id: string) => readonly OnlineInput[]): void;
};

export function createRoomSim(game: OnlineGame): RoomSim {
	const { online, field } = game;
	const ctx = stepContext(online.tickHz, online.subSteps);
	const players = new Map<string, SimPlayer>();
	let steps = 0;

	const countOf = (characterId: string) =>
		[...players.values()].filter((p) => p.character.id === characterId).length;
	const hasPlace = (c: ArcadeOnlineCharacter) => c.max === undefined || countOf(c.id) < c.max;

	const pick = (asked: unknown): ArcadeOnlineCharacter => {
		if (asked === undefined || asked === null || asked === '') {
			const free = online.characters.find(hasPlace);
			if (!free) throw new RoomRefusal('every character is taken');
			return free;
		}
		const character = online.characters.find((c) => c.id === asked);
		if (!character) throw new RoomRefusal('unknown character');
		if (!hasPlace(character)) throw new RoomRefusal(`no place left for ${character.id}`);
		return character;
	};

	return {
		game,
		ctx,
		players,
		get steps() {
			return steps;
		},
		join(id, options) {
			if (players.has(id)) throw new RoomRefusal('already in the room');
			if (players.size >= online.maxPlayers) throw new RoomRefusal('the room is full');
			const character = pick(options.character);
			const player: SimPlayer = {
				id,
				name: cleanName(options.name) || 'Player',
				character,
				body: characterBody(id, game.bodies[character.body], online.spawn),
				facing: 0,
				moving: false,
				connected: true,
				ack: 0,
			};
			// A spawn outside the field is pulled inside at once, as every later step would.
			stepPlayer(player.body, undefined, character.speed, { ...ctx, subSteps: 1, subDt: 0 }, field);
			players.set(id, player);
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
			players.delete(id);
		},
		step(take) {
			for (const player of players.values()) {
				const inputs = player.connected ? take(player.id) : [];
				if (!inputs.length) {
					stepPlayer(player.body, undefined, player.character.speed, ctx, field);
					player.moving = false;
				}
				for (const input of inputs) {
					stepPlayer(player.body, input, player.character.speed, ctx, field);
					player.ack = input.seq;
					player.facing = facingOf(input, player.facing);
					player.moving = input.moveX !== 0 || input.moveY !== 0;
				}
			}
			steps += 1;
		},
	};
}
