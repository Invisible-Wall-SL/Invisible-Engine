import { CloseCode, Room, type Client } from '@colyseus/core';
import { sanitizeInput, type OnlineInput } from 'engine-mechanics';

import type { LoadGame } from './configSource.ts';
import { addressOfSocket, holdSeat, releaseSeat } from './addresses.ts';
import { closedByGuard } from './socketGuard.ts';
import { createRoomSim, inputsThisStep, RoomRefusal, type RoomSim } from './roomSim.ts';
import { Input, Player, RoomState, type InputFrame, type RoomStateData } from './schema.ts';

/**
 * ONE ROOM OF AN ONLINE ARCADE GAME (`docs/design/realtime-multiplayer.md` §5, §8, §9, §11), on
 * Colyseus 0.18. Rooms are matched by `game` (`filterBy`), so a device joins a room of its own
 * game with space or creates one. The room runs {@link createRoomSim}; Colyseus supplies the fixed
 * step, the typed input stream and the reconnection.
 *
 * WHAT A DEVICE CAN DO: send {@link Input} (one per step on the reliable channel the runtime uses,
 * clamped by `sanitizeInput` as it is decoded, a repeated or older `seq` dropped, at most
 * {@link INPUT_BUFFER} held), and join with a `name` and a `character`. Any other frame closes
 * its socket before it is decoded (`socketGuard.ts`). A step applies the inputs {@link inputsThisStep}
 * allows, each as a step of its own, so a burst after a stall drains instead of becoming lag, and
 * sending more than one a step never moves a player faster. The
 * step reads plain bodies and writes the schema once per patch, never once per step.
 *
 * LIMITS (§11): a room holds `maxPlayers` (≤ 100) and each character's `max`; a device sending
 * more than {@link messagesPerSecond} messages a second is disconnected; the transport caps a
 * message's size (`server.ts`); the process holds at most `maxRooms` rooms.
 */

/** Inputs a player may have waiting: one second at the fastest step rate. Overflow drops the oldest. */
const INPUT_BUFFER = 60;

/** What a device is told when its room cannot be made: the reason stays in the server's log. */
const UNAVAILABLE = 'this game is not available';

/** A device's allowance: one input per step, with room for a burst after a stall. */
export const messagesPerSecond = (tickHz: number) => tickHz * 2 + 10;

export type ArcadeRoomDeps = {
	loadGame: LoadGame;
	maxRooms: number;
	/** How long a seat is held for a device that has not connected yet. */
	seatSeconds: number;
	/** Rooms alive in this process. */
	rooms: { count: number };
};

type CreateOptions = { game?: unknown };
type JoinOptions = { name?: unknown; character?: unknown };

export function arcadeRoomClass(deps: ArcadeRoomDeps) {
	return class ArcadeRoom extends Room<{ state: RoomStateData; input: InputFrame }> {
		state = new RoomState();
		sim: RoomSim | undefined;
		game = '';
		counted = false;
		inputs = this.defineInput(Input, {
			seqField: 'seq',
			bufferMaxSize: INPUT_BUFFER,
			sanitize: (frame: InputFrame) => {
				sanitizeInput(frame as OnlineInput, this.sim?.game.field);
			},
		});

		async onCreate(options: CreateOptions) {
			const full = () => deps.rooms.count >= deps.maxRooms;
			if (full()) throw new RoomRefusal('the server holds no more rooms');
			// A key that is not a string would never match `filterBy`, so every join would make a room.
			if (typeof options.game !== 'string') throw new RoomRefusal(UNAVAILABLE);
			const game = options.game;
			const loaded = await deps.loadGame(game).catch((error: unknown) => {
				console.warn(`[game-server] no room for "${game.slice(0, 64)}": ${String(error)}`);
				throw new RoomRefusal(UNAVAILABLE);
			});
			if (full()) throw new RoomRefusal('the server holds no more rooms');
			deps.rooms.count += 1;
			this.counted = true;
			const sim = createRoomSim(loaded);
			this.sim = sim;
			const { online } = sim.game;
			this.maxClients = online.maxPlayers;
			this.seatReservationTimeout = deps.seatSeconds;
			this.maxMessagesPerSecond = messagesPerSecond(online.tickHz);
			this.state.phase = 'waiting';
			this.game = game;
			await this.listPlayers();
			this.setPatchRate(1000 / online.patchHz);
			this.setFixedTimestep(
				() => {
					sim.step((id, credit) => {
						const buffer = this.inputs.get(id);
						return buffer.take(inputsThisStep(buffer.size, credit)) as OnlineInput[];
					});
				},
				online.tickHz,
				{ subSteps: online.subSteps },
			);
		}

		onJoin(client: Client, options: JoinOptions = {}) {
			const sim = this.requireSim();
			const joined = sim.join(client.sessionId, options ?? {});
			const player = new Player();
			player.name = joined.name;
			player.character = joined.character.id;
			player.connected = true;
			this.state.players.set(client.sessionId, player);
			this.write(client.sessionId);
			this.state.phase = 'running';
			void this.listPlayers();
		}

		onDrop(client: Client, code?: number) {
			const sim = this.requireSim();
			// A device whose join was refused is dropped too, and has no place to hold.
			if (!sim.players.has(client.sessionId)) return;
			sim.drop(client.sessionId);
			const player = this.state.players.get(client.sessionId);
			if (player) player.connected = false;
			// The server closed it for an error (a flood, a frame it refuses): no place is held for it.
			const refused = code === CloseCode.WITH_ERROR || closedByGuard(client.ref);
			const seconds = refused ? 0 : sim.game.online.rejoinSeconds;
			if (seconds <= 0) return;
			// The held seat counts against its address until it is reclaimed or let go, so dropping
			// and rejoining cannot gather seats past the address's cap (`addresses.ts`).
			const address = addressOfSocket(client.ref);
			// Read now: a reconnect hands the client the replacement's token.
			const token = client.reconnectionToken;
			if (address !== undefined) holdSeat(address, client.sessionId, token);
			const settled = () => {
				if (address !== undefined) releaseSeat(address, token);
			};
			this.allowReconnection(client, seconds).then(settled, settled);
		}

		onReconnect(client: Client) {
			this.requireSim().rejoin(client.sessionId);
			const player = this.state.players.get(client.sessionId);
			if (player) player.connected = true;
		}

		onLeave(client: Client) {
			const sim = this.requireSim();
			sim.leave(client.sessionId);
			this.state.players.delete(client.sessionId);
			void this.listPlayers();
		}

		onBeforePatch() {
			const sim = this.sim;
			if (!sim) return;
			this.state.step = sim.steps;
			for (const id of sim.players.keys()) this.write(id);
		}

		onDispose() {
			if (this.counted) deps.rooms.count -= 1;
			this.counted = false;
		}

		/** The listing: `game` is what `filterBy` matches, so every write carries it. */
		private listPlayers() {
			return this.setMetadata({
				game: this.game,
				players: this.sim?.players.size ?? 0,
				maxPlayers: this.maxClients,
			});
		}

		private write(id: string) {
			const from = this.sim?.players.get(id);
			const to = this.state.players.get(id);
			if (!from || !to) return;
			to.x = from.body.x;
			to.y = from.body.y;
			to.facing = from.facing;
			to.moving = from.moving;
			to.ack = from.ack;
		}

		private requireSim(): RoomSim {
			if (!this.sim) throw new RoomRefusal('the room is not ready');
			return this.sim;
		}
	};
}
