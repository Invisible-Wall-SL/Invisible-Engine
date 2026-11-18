import { CloseCode, Room, type Client } from '@colyseus/core';
import { ONLINE_EVENT, roomLevelSeed } from 'engine-mechanics';
import { sanitizeInput3d, type Input3d } from 'engine-mechanics/src/online3d.js';

import { addressOfSocket, holdSeat, releaseSeat } from './addresses.ts';
import type { ArcadeRoomDeps } from './arcadeRoom.ts';
import { messagesPerSecond } from './arcadeRoom.ts';
import { RoomRefusal, inputsThisStep } from './roomSim.ts';
import { createRoomSim3d, type Online3dEvent, type RoomSim3d } from './roomSim3d.ts';
import {
	Entity3D,
	Input3D,
	Player3D,
	RoomState3D,
	type Input3DFrame,
	type RoomState3DData,
} from './schema.ts';
import { closedByGuard } from './socketGuard.ts';

/**
 * ONE ROOM OF AN ONLINE 3D ARCADE GAME (`docs/design/3d/gameplay-evaluation.md` §3–§4): the 2D
 * room (`arcadeRoom.ts`) for a game whose config has an `arcade.world3d` block, running
 * {@link createRoomSim3d} on the {@link Input3D} / {@link RoomState3D} wire. Matched by `game` like
 * the 2D room, under its own name, so a 2D room never meets a 3D device; each refuses the other's
 * games. Shares the 2D room's limits: the process's room count, the seat deadline, the message
 * budget, the socket guard and the per-address seats.
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
			const sim = createRoomSim3d(loaded, loaded.world3d, { seed, rules: loaded.rules3d });
			if (loaded.online.bots.fillTo > 0)
				console.log(`[game-server] 3D room ${this.roomId} of "${game}": seed ${seed}`);
			this.sim = sim;
			const { online } = sim.game;
			this.maxClients = online.maxPlayers;
			this.seatReservationTimeout = deps.seatSeconds;
			this.maxMessagesPerSecond = messagesPerSecond(online.tickHz);
			this.state.phase = sim.phase;
			this.state.seed = seed;
			this.game = game;
			await this.listPlayers();
			this.setPatchRate(1000 / online.patchHz);
			this.setFixedTimestep(() => {
				const started = deps.onStep ? performance.now() : 0;
				const events = sim.step((id, credit) => {
					const buffer = this.inputs.get(id);
					return buffer.take(inputsThisStep(buffer.size, credit)) as Input3d[];
				});
				this.announce(events);
				deps.onStep?.(performance.now() - started);
			}, online.tickHz);
		}

		onJoin(client: Client, options: JoinOptions = {}) {
			const sim = this.requireSim();
			sim.join(client.sessionId, options ?? {});
			this.syncPlayers();
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
		}

		onLeave(client: Client) {
			const sim = this.requireSim();
			sim.leave(client.sessionId);
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
			this.writeRules();
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

		private write(id: string) {
			const from = this.sim?.players.get(id);
			const to = this.state.players.get(id);
			if (!from || !to) return;
			to.x = from.body.x;
			to.y = from.body.y;
			to.z = from.body.z;
			to.yaw = from.body.yaw;
			to.status = from.status;
			to.anim = from.anim;
			to.ack = from.ack;
			if (!this.sim?.rules) return;
			to.hp = from.hp;
			to.shield = from.shield;
			to.hero = from.hero;
			to.weapon = from.weapon;
			to.carrying = from.carrying;
		}

		/** The rules' round, scores, pit and entities (a room without rules has none). */
		private writeRules() {
			const rules = this.sim?.rules;
			if (!rules) return;
			const state = this.state;
			state.round = rules.round;
			state.endsAt = rules.endsAt;
			state.winner = rules.winner;
			state.pitLevel = rules.pitLevel;
			while (state.scores.length < 2) state.scores.push(0);
			for (let i = 0; i < 2; i++)
				if (state.scores[i] !== rules.scores[i]) state.scores[i] = rules.scores[i];
			for (const id of [...state.entities.keys()])
				if (!rules.entities.has(id)) state.entities.delete(id);
			for (const [id, from] of rules.entities) {
				let to = state.entities.get(id);
				if (!to) {
					to = new Entity3D();
					to.kind = from.kind;
					to.owner = from.owner;
					state.entities.set(id, to);
				}
				to.x = from.body.x;
				to.y = from.body.y;
				to.z = from.body.z;
				to.carriedBy = from.carriedBy;
				to.state = from.state;
			}
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
