import { CloseCode, Room, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { ONLINE_EVENT, sanitizeInput, type OnlineEvent, type OnlineInput } from 'engine-mechanics';

import type { LoadGame } from './configSource.ts';
import { addressOfSocket, holdSeat, releaseSeat } from './addresses.ts';
import { closedByGuard } from './socketGuard.ts';
import { createRoomSim, inputsThisStep, RoomRefusal, type RoomSim } from './roomSim.ts';
import {
	Input,
	NearbyPlayer,
	NearbyRoomState,
	Player,
	VIEW_TAG,
	RoomState,
	type InputFrame,
	type RoomStateData,
} from './schema.ts';

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

/** A player leaves a device's view only this far past its `nearby` box (a fraction of the box), so
 *  one that hovers on the edge is not sent away and back every patch. */
const NEARBY_MARGIN = 0.25;

/** The players an event is about (none: the room's own, a round's start or end). */
const namedIn = (event: OnlineEvent): string[] => {
	if ('id' in event) return [event.id];
	if ('target' in event) return [event.by, event.target];
	if ('by' in event) return [event.by];
	return [];
};

/** A device's allowance: one input per step, with room for a burst after a stall. */
export const messagesPerSecond = (tickHz: number) => tickHz * 2 + 10;

export type ArcadeRoomDeps = {
	loadGame: LoadGame;
	maxRooms: number;
	/** How long a seat is held for a device that has not connected yet. */
	seatSeconds: number;
	/** Rooms alive in this process. */
	rooms: { count: number };
	/** Told how long each step took, ms. */
	onStep?: (ms: number) => void;
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
			// The bots' seed is logged, so a room's bots can be replayed from the log.
			const seed = Math.floor(Math.random() * 0x7fffffff);
			const sim = createRoomSim(loaded, { seed });
			if (loaded.online.bots.fillTo > 0)
				console.log(`[game-server] room ${this.roomId} of "${game}": bot seed ${seed}`);
			this.sim = sim;
			const { online } = sim.game;
			this.maxClients = online.maxPlayers;
			this.seatReservationTimeout = deps.seatSeconds;
			this.maxMessagesPerSecond = messagesPerSecond(online.tickHz);
			if (online.nearby) this.state = new NearbyRoomState();
			this.state.phase = 'waiting';
			this.game = game;
			await this.listPlayers();
			this.setPatchRate(1000 / online.patchHz);
			this.setFixedTimestep(
				() => {
					const started = deps.onStep ? performance.now() : 0;
					const events = sim.step((id, credit) => {
						const buffer = this.inputs.get(id);
						return buffer.take(inputsThisStep(buffer.size, credit)) as OnlineInput[];
					});
					this.announce(events);
					deps.onStep?.(performance.now() - started);
				},
				online.tickHz,
				{ subSteps: online.subSteps },
			);
		}

		onJoin(client: Client, options: JoinOptions = {}) {
			const sim = this.requireSim();
			const before = this.seenNow();
			sim.join(client.sessionId, options ?? {});
			this.syncPlayers();
			this.writeRoom();
			if (sim.game.online.nearby) {
				client.view = new StateView();
				this.seen.set(client.sessionId, new Set());
				this.nearby();
			}
			this.announce(sim.events(), before);
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
			const before = this.seenNow();
			sim.leave(client.sessionId);
			this.seen.delete(client.sessionId);
			client.view?.dispose();
			this.syncPlayers();
			if (sim.game.online.nearby) this.nearby();
			this.announce(sim.events(), before);
			void this.listPlayers();
		}

		onBeforePatch() {
			const sim = this.sim;
			if (!sim) return;
			this.writeRoom();
			for (const id of sim.players.keys()) this.write(id);
			if (sim.game.online.nearby) this.nearby();
		}

		onDispose() {
			if (this.counted) deps.rooms.count -= 1;
			this.counted = false;
		}

		/** The listing: `game` is what `filterBy` matches, so every write carries it. `players` counts
		 *  people, not bots: a person can always take a bot's place. */
		private listPlayers() {
			return this.setMetadata({
				game: this.game,
				players: [...(this.sim?.players.values() ?? [])].filter((p) => !p.bot).length,
				maxPlayers: this.maxClients,
			});
		}

		/** Room player ids each device's view holds, by session (`online.nearby` only). */
		private seen = new Map<string, Set<string>>();

		/**
		 * Each device's view made the players inside its `nearby` box around its own player (itself
		 * always), keeping one until it is {@link NEARBY_MARGIN} past the box. A pass over every pair:
		 * a hundred players is ten thousand comparisons a patch.
		 */
		private nearby() {
			const sim = this.requireSim();
			const box = sim.game.online.nearby;
			if (!box) return;
			const keepW = (box.w / 2) * (1 + NEARBY_MARGIN);
			const keepH = (box.h / 2) * (1 + NEARBY_MARGIN);
			for (const client of this.clients) {
				const view = client.view;
				const seen = this.seen.get(client.sessionId);
				const me = sim.players.get(client.sessionId);
				if (!view || !seen || !me) continue;
				for (const [id, other] of sim.players) {
					const dx = Math.abs(other.body.x - me.body.x);
					const dy = Math.abs(other.body.y - me.body.y);
					const has = seen.has(id);
					const near = id === me.id || (dx <= box.w / 2 && dy <= box.h / 2);
					const kept = has && dx <= keepW && dy <= keepH;
					const player = this.state.players.get(id);
					if (!player) continue;
					if (near && !has) {
						view.add(player, VIEW_TAG.near);
						if (id === me.id) view.add(player, VIEW_TAG.own);
						seen.add(id);
					} else if (has && !near && !kept) {
						view.remove(player);
						seen.delete(id);
					}
				}
				for (const id of seen) if (!sim.players.has(id)) seen.delete(id);
			}
		}

		/** A copy of every device's view before a join or a leave changes the room: a bot it sends
		 *  away is told to the devices that held it, though no view holds it after. */
		private seenNow(): Map<string, Set<string>> {
			return new Map([...this.seen].map(([id, ids]) => [id, new Set(ids)]));
		}

		/** The state's players made the room's: bots come and go as people join and leave. */
		private syncPlayers() {
			const sim = this.requireSim();
			for (const id of [...this.state.players.keys()])
				if (!sim.players.has(id)) this.state.players.delete(id);
			for (const [id, from] of sim.players) {
				if (this.state.players.has(id)) continue;
				const player = sim.game.online.nearby ? new NearbyPlayer() : new Player();
				player.name = from.name;
				player.character = from.character.id;
				player.connected = from.connected;
				player.bot = from.bot === true;
				this.state.players.set(id, player);
				this.write(id);
			}
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
			to.score = from.score;
			to.status = from.status;
			to.mark = from.mark;
		}

		private writeRoom() {
			const sim = this.sim;
			if (!sim) return;
			this.state.step = sim.steps;
			this.state.phase = sim.rules.phase;
			this.state.round = sim.rules.round;
			this.state.endsAt = sim.rules.endsAt;
			this.state.winner = sim.rules.winner;
		}

		/**
		 * Tell every device what happened, in one message, after the patch that shows it. In a nearby
		 * room a device is told only of the players its view holds — or held `before` a join or a
		 * leave changed the room — and of the room's rounds, so a far player's id and fate reach
		 * nobody it is not sent to. Step events (no `before`) are filtered by the views as of the last
		 * patch.
		 */
		private announce(
			events: readonly OnlineEvent[],
			before?: ReadonlyMap<string, ReadonlySet<string>>,
		) {
			if (!events.length) return;
			if (!this.sim?.game.online.nearby) {
				this.broadcast(ONLINE_EVENT, events, { afterNextPatch: true });
				return;
			}
			for (const client of this.clients) {
				const seen = this.seen.get(client.sessionId);
				const had = before?.get(client.sessionId);
				const told = events.filter((event) => {
					const named = namedIn(event);
					return (
						!named.length ||
						named.some((id) => id === client.sessionId || seen?.has(id) || had?.has(id))
					);
				});
				if (told.length) client.send(ONLINE_EVENT, told, { afterNextPatch: true });
			}
		}

		private requireSim(): RoomSim {
			if (!this.sim) throw new RoomRefusal('the room is not ready');
			return this.sim;
		}
	};
}
