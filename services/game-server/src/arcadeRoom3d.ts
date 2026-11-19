import { CloseCode, Room, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { ONLINE_EVENT, roomLevelSeed } from 'engine-mechanics';
import {
	bodyFlags3d,
	sanitizeInput3d,
	worldHash3d,
	type Input3d,
} from 'engine-mechanics/src/online3d.js';

import { addressOfSocket, holdSeat, releaseSeat } from './addresses.ts';
import type { ArcadeRoomDeps } from './arcadeRoom.ts';
import { messagesPerSecond } from './arcadeRoom.ts';
import { CREDIT_SECONDS, RoomRefusal, inputsThisStep } from './roomSim.ts';
import { createRoomSim3d, type Online3dEvent, type RoomSim3d } from './roomSim3d.ts';
import {
	Input3D,
	Player3D,
	RoomState3D,
	VIEW_TAG,
	type Input3DFrame,
	type RoomState3DData,
} from './schema.ts';
import { closedByGuard } from './socketGuard.ts';
import { createStepLedger } from './stepLedger.ts';

/**
 * ONE ROOM OF AN ONLINE 3D ARCADE GAME (`docs/design/3d/gameplay-evaluation.md` §3–§4): the 2D
 * room (`arcadeRoom.ts`) for a game whose config has an `arcade.world3d` block, running
 * {@link createRoomSim3d} on the {@link Input3D} / {@link RoomState3D} wire. Matched by `game` like
 * the 2D room, under its own name, so a 2D room never meets a 3D device; each refuses the other's
 * games. Shares the 2D room's limits: the process's room count, the seat deadline, the message
 * budget, the socket guard and the per-address seats. Each device's `StateView` holds its own
 * player with `VIEW_TAG.own`, so only it is sent that player's whole body and clock.
 */

/** Inputs a player may have waiting: one second at the fastest step rate. */
const INPUT_BUFFER = 60;

const UNAVAILABLE = 'this game is not available';

type CreateOptions = { game?: unknown };
type JoinOptions = { name?: unknown; character?: unknown };

export function arcadeRoom3dClass(deps: ArcadeRoomDeps) {
	const levelTurns = new Map<string, number>();
	return class ArcadeRoom3d extends Room<{ state: RoomState3DData; input: Input3DFrame }> {
		state = new RoomState3D();
		sim: RoomSim3d | undefined;
		game = '';
		counted = false;
		inputs = this.defineInput(Input3D, {
			seqField: 'seq',
			bufferMaxSize: INPUT_BUFFER,
			sanitize: (frame: Input3DFrame) => {
				sanitizeInput3d(frame as Input3d);
			},
		});

		async onCreate(options: CreateOptions) {
			const full = () => deps.rooms.count >= deps.maxRooms;
			if (full()) throw new RoomRefusal('the server holds no more rooms');
			if (typeof options.game !== 'string') throw new RoomRefusal(UNAVAILABLE);
			const game = options.game;
			const loaded = await deps.loadGame(game).catch((error: unknown) => {
				console.warn(`[game-server] no 3D room for "${game.slice(0, 64)}": ${String(error)}`);
				throw new RoomRefusal(UNAVAILABLE);
			});
			if (!loaded.world3d) throw new RoomRefusal(UNAVAILABLE);
			if (full()) throw new RoomRefusal('the server holds no more rooms');
			deps.rooms.count += 1;
			this.counted = true;
			const turn = levelTurns.get(game) ?? 0;
			levelTurns.set(game, turn + 1);
			const seed = roomLevelSeed(loaded.online.levels, turn, () =>
				Math.floor(Math.random() * 0x7fffffff),
			);
			const sim = createRoomSim3d(loaded, loaded.world3d, { seed });
			if (loaded.online.bots.fillTo > 0)
				console.log(`[game-server] 3D room ${this.roomId} of "${game}": seed ${seed}`);
			this.sim = sim;
			const { online } = sim.game;
			this.maxClients = online.maxPlayers;
			this.seatReservationTimeout = deps.seatSeconds;
			this.maxMessagesPerSecond = messagesPerSecond(online.tickHz);
			this.state.phase = sim.phase;
			this.state.seed = seed;
			this.state.world = worldHash3d(loaded.world3d, online.tickHz);
			this.game = game;
			await this.listPlayers();
			this.setPatchRate(1000 / online.patchHz);
			const take = (id: string, credit: number) => {
				const buffer = this.inputs.get(id);
				return buffer.take(inputsThisStep(buffer.size, credit)) as Input3d[];
			};
			// Colyseus' timer only paces the room: it steps as the wall clock says (`stepLedger.ts`).
			const ledger = createStepLedger({
				hz: online.tickHz,
				catchUp: Math.ceil(online.tickHz * CREDIT_SECONDS),
			});
			this.setFixedTimestep(() => {
				const due = ledger.due();
				for (let n = 0; n < due; n++) {
					const started = deps.onStep ? performance.now() : 0;
					this.announce(sim.step(take, { catchUp: n > 0 }));
					deps.onStep?.(performance.now() - started);
				}
			}, online.tickHz);
		}

		onJoin(client: Client, options: JoinOptions = {}) {
			const sim = this.requireSim();
			sim.join(client.sessionId, options ?? {});
			this.syncPlayers();
			this.ownView(client);
			this.announce(sim.events());
			void this.listPlayers();
		}

		onDrop(client: Client, code?: number) {
			const sim = this.requireSim();
			if (!sim.players.has(client.sessionId)) return;
			sim.drop(client.sessionId);
			const player = this.state.players.get(client.sessionId);
			if (player) player.connected = false;
			const refused = code === CloseCode.WITH_ERROR || closedByGuard(client.ref);
			const seconds = refused ? 0 : sim.game.online.rejoinSeconds;
			if (seconds <= 0) return;
			const address = addressOfSocket(client.ref);
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
			if (!client.view) this.ownView(client);
		}

		onLeave(client: Client) {
			const sim = this.requireSim();
			sim.leave(client.sessionId);
			client.view?.dispose();
			this.syncPlayers();
			this.announce(sim.events());
			void this.listPlayers();
		}

		onBeforePatch() {
			const sim = this.sim;
			if (!sim) return;
			this.state.step = sim.steps;
			this.state.phase = sim.phase;
			for (const id of sim.players.keys()) this.write(id);
		}

		onDispose() {
			if (this.counted) deps.rooms.count -= 1;
			this.counted = false;
		}

		private listPlayers() {
			return this.setMetadata({
				game: this.game,
				players: [...(this.sim?.players.values() ?? [])].filter((p) => !p.bot).length,
				maxPlayers: this.maxClients,
			});
		}

		private syncPlayers() {
			const sim = this.requireSim();
			for (const id of [...this.state.players.keys()])
				if (!sim.players.has(id)) this.state.players.delete(id);
			for (const [id, from] of sim.players) {
				if (this.state.players.has(id)) continue;
				const player = new Player3D();
				player.name = from.name;
				player.character = from.character.id;
				player.team = from.team;
				player.connected = from.connected;
				player.bot = from.bot === true;
				this.state.players.set(id, player);
				this.write(id);
			}
			this.state.phase = sim.phase;
		}

		/** The device's view: its own player, with the fields only it is sent. */
		private ownView(client: Client) {
			const player = this.state.players.get(client.sessionId);
			if (!player) return;
			client.view = new StateView();
			client.view.add(player, VIEW_TAG.own);
		}

		private write(id: string) {
			const from = this.sim?.players.get(id);
			const to = this.state.players.get(id);
			if (!from || !to) return;
			const { body } = from;
			to.x = body.x;
			to.y = body.y;
			to.z = body.z;
			to.yaw = body.yaw;
			to.status = from.status;
			to.anim = from.anim;
			to.ack = from.ack;
			if (from.bot) return;
			to.bx = body.x;
			to.by = body.y;
			to.bz = body.z;
			to.vx = body.vx;
			to.vy = body.vy;
			to.vz = body.vz;
			to.coyote = body.coyote;
			to.buffer = body.buffer;
			to.climb = body.climb;
			to.flags = bodyFlags3d(body);
			to.credit = from.credit;
			to.waiting = this.inputs.get(id).size;
		}

		/** Every device is told what happened, in one message, after the patch that shows it. */
		private announce(events: readonly Online3dEvent[]) {
			if (events.length) this.broadcast(ONLINE_EVENT, events, { afterNextPatch: true });
		}

		private requireSim(): RoomSim3d {
			if (!this.sim) throw new RoomRefusal('the room is not ready');
			return this.sim;
		}
	};
}
