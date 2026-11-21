import { randomUUID } from 'node:crypto';

import { CloseCode, Room, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import {
	ONLINE_EVENT,
	STATUS,
	boxRegion,
	holdView,
	nearbyHolds,
	pastRegion,
	roomLevelSeed,
	sanitizeInput,
	viewRegion,
	type HeldView,
	type OnlineEvent,
	type OnlineInput,
} from 'engine-mechanics';

import { SizeRefusal, type LoadGame } from './configSource.ts';
import { addressOfSocket, holdSeat, releaseSeat } from './addresses.ts';
import { closedByGuard } from './socketGuard.ts';
import {
	CREDIT_SECONDS,
	createRoomSim,
	inputsThisStep,
	RoomRefusal,
	type RoomSim,
} from './roomSim.ts';
import { createStepLedger } from './stepLedger.ts';
import {
	Input,
	NearbyPlayer,
	NearbyRoomState,
	Player,
	VIEW_TAG,
	RoomState,
	Stain,
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
 * {@link INPUT_BUFFER} held), and join with a `name` and a `character`. An input also says what
 * the device's screen shows; a room whose `nearby` has a `max` sends it the players in that view
 * as well as those in the box, and it reaches nothing else (§5, §11). Any other frame closes
 * its socket before it is decoded (`socketGuard.ts`). A step applies the inputs {@link inputsThisStep}
 * allows, each as a step of its own, so a burst after a stall drains instead of becoming lag, and
 * sending more than one a step never moves a player faster. The
 * step reads plain bodies and writes the schema once per patch, never once per step.
 *
 * ONE GAME A ROOM (`round.endsGame`, Salmons): when the game is won the room locks — nobody new
 * joins it — and the winner's device alone is sent a WINNER'S PASS (an online event `winnerPass`
 * with `pass`). A device that joins a new room of the same game with `{ pass }` within
 * {@link PASS_SECONDS} comes in as the last game's winner (`wonLast`: Salmons' golden salmon); a
 * pass works once (spent only by a join that is let in), and nothing a device claims otherwise
 * makes it a winner. A bot that wins (Salmons' bot salmon at the source) is given no pass, and no
 * device is. A won room closes {@link WON_ROOM_SECONDS} after the win.
 *
 * A TEST ROOM (`server.ts` `ROOM_NAME_TEST`, the class made with {@link TestRooms}) plays the game
 * at a `size` of its own instead of the config's room size: `{ game, size }` creates it, matched
 * by both, so it never shares matchmaking with the game's public rooms. The size is a whole number
 * inside the game's test range (`configSource.ts`) or the room is refused, with the reason — never
 * clamped, so the key a room is matched by is its real size — and a join whose `game` or `size`
 * is not the room's own is refused too (a join that names none would otherwise match any). The
 * process holds at most `TestRooms.max` of them, each counted in `maxRooms` as well.
 *
 * LIMITS (§11): a room holds `maxPlayers` (≤ 100) and each character's `max`; a device sending
 * more than {@link messagesPerSecond} messages a second is disconnected; the transport caps a
 * message's size (`server.ts`); the process holds at most `maxRooms` rooms.
 */

/** Inputs a player may have waiting: one second at the fastest step rate. Overflow drops the oldest. */
const INPUT_BUFFER = 60;

/** What a device is told when its room cannot be made: the reason stays in the server's log. */
const UNAVAILABLE = 'this game is not available';

/** A player leaves a device's view only this far past its nearby region (a fraction of it), so
 *  one that hovers on the edge is not sent away and back every patch. */
export const NEARBY_MARGIN = 0.25;

/** How long a device's declared view is held, s: it grows at once and shrinks at most once this
 *  long (`engine-mechanics` `holdView`). A player that comes into a view is sent in full, so a
 *  device saying a small view and a large one in turn would otherwise be sent everyone each
 *  time. */
export const VIEW_HOLD_SECONDS = 1;

/** How long a winner's pass lets its device in as the last game's winner, s. */
const PASS_SECONDS = 600;

/** How long a won room stays open for its devices' win screens, s; then it closes. */
const WON_ROOM_SECONDS = 600;

/** The most passes held at once: past it the oldest goes. */
const PASS_LIMIT = 10_000;

/** Winner's passes not yet used, by pass: the game it was won in and when it lapses (ms). */
const passes = new Map<string, { game: string; until: number }>();

/** A new pass for the winner of a game of `game`. */
export function issuePass(game: string, now = Date.now()): string {
	for (const [pass, held] of passes) if (held.until <= now) passes.delete(pass);
	while (passes.size >= PASS_LIMIT) passes.delete(passes.keys().next().value as string);
	const pass = randomUUID();
	passes.set(pass, { game, until: now + PASS_SECONDS * 1000 });
	return pass;
}

/** Whether `pass` is a live winner's pass of `game`; a pass that is works once. */
export function redeemPass(pass: unknown, game: string, now = Date.now()): boolean {
	if (typeof pass !== 'string' || pass.length > 64) return false;
	const held = passes.get(pass);
	if (!held || held.game !== game || held.until <= now) return false;
	passes.delete(pass);
	return true;
}

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
	/** Told how long each patch's pass over the devices' nearby regions took, ms. */
	onNearby?: (ms: number) => void;
};

/** The test rooms a process holds: the most (`0`: none), and how many are alive. */
export type TestRooms = { max: number; count: number };

type CreateOptions = { game?: unknown; size?: unknown };
type JoinOptions = {
	name?: unknown;
	character?: unknown;
	pass?: unknown;
	game?: unknown;
	size?: unknown;
};

/** The room class of a game's public rooms, or with `test` of its test rooms. */
export function arcadeRoomClass(deps: ArcadeRoomDeps, test?: TestRooms) {
	/** Rooms made per game, so each new room takes the next of its pinned levels. */
	const levelTurns = new Map<string, number>();
	return class ArcadeRoom extends Room<{ state: RoomStateData; input: InputFrame }> {
		state = new RoomState();
		sim: RoomSim | undefined;
		game = '';
		counted = false;
		/** A test room's size; `undefined` in a public room. */
		size: number | undefined;
		/** How many of the rules' stains the state has been given (`OnlineRules.stains.made`). */
		stainsWritten = 0;
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
			const testsFull = () => test !== undefined && test.count >= test.max;
			let size: number | undefined;
			if (test) {
				if (test.max <= 0) throw new RoomRefusal('this server holds no test rooms');
				if (testsFull()) throw new RoomRefusal('the server holds no more test rooms');
				// Anything but a number would never match `filterBy` either.
				if (typeof options.size !== 'number' || !Number.isInteger(options.size))
					throw new RoomRefusal('a test room needs a whole number of players (room_size)');
				size = options.size;
			}
			const loaded = await deps.loadGame(game, size).catch((error: unknown) => {
				if (error instanceof SizeRefusal) throw new RoomRefusal(error.message);
				console.warn(`[game-server] no room for "${game.slice(0, 64)}": ${String(error)}`);
				throw new RoomRefusal(UNAVAILABLE);
			});
			// A 3D game plays in the 3D room (`arcadeRoom3d.ts`): this room's step is the plane's.
			if (loaded.world3d) throw new RoomRefusal(UNAVAILABLE);
			if (full()) throw new RoomRefusal('the server holds no more rooms');
			if (testsFull()) throw new RoomRefusal('the server holds no more test rooms');
			deps.rooms.count += 1;
			if (test) test.count += 1;
			this.counted = true;
			this.size = size;
			// The seed is logged, so a room's bots and generated field can be replayed from the log. A
			// config's pinned levels are taken in turn; with none, each room gets a new random one.
			const turn = levelTurns.get(game) ?? 0;
			levelTurns.set(game, turn + 1);
			const seed = roomLevelSeed(loaded.online.levels, turn, () =>
				Math.floor(Math.random() * 0x7fffffff),
			);
			const sim = createRoomSim(loaded, { seed });
			if (size !== undefined)
				console.log(
					`[game-server] test room ${this.roomId} of "${game}": size ${size}, seed ${seed}`,
				);
			else if (loaded.online.bots.fillTo > 0 || loaded.online.generator)
				console.log(`[game-server] room ${this.roomId} of "${game}": seed ${seed}`);
			this.sim = sim;
			const { online } = sim.game;
			this.maxClients = online.maxPlayers;
			this.seatReservationTimeout = deps.seatSeconds;
			this.maxMessagesPerSecond = messagesPerSecond(online.tickHz);
			if (online.nearby) this.state = new NearbyRoomState();
			this.state.phase = 'waiting';
			this.state.seed = seed;
			this.game = game;
			await this.listPlayers();
			this.setPatchRate(1000 / online.patchHz);
			const take = (id: string, credit: number) => {
				const buffer = this.inputs.get(id);
				return buffer.take(inputsThisStep(buffer.size, credit)) as OnlineInput[];
			};
			// Colyseus' timer only paces the room: it steps as the wall clock says (`stepLedger.ts`).
			const ledger = createStepLedger({
				hz: online.tickHz,
				catchUp: Math.ceil(online.tickHz * CREDIT_SECONDS),
			});
			this.setFixedTimestep(
				() => {
					for (let n = ledger.due(); n > 0; n--) {
						const started = deps.onStep ? performance.now() : 0;
						const events = sim.step(take);
						this.announce(events);
						if (events.some((event) => event.type === 'gameWon')) this.won(sim);
						deps.onStep?.(performance.now() - started);
					}
				},
				online.tickHz,
				{ subSteps: online.subSteps },
			);
		}

		onJoin(client: Client, options: JoinOptions = {}) {
			const sim = this.requireSim();
			const before = this.seenNow();
			const { name, character, pass } = options ?? {};
			if (this.size !== undefined && (options?.game !== this.game || options.size !== this.size))
				throw new RoomRefusal('this is a test room of another game or size');
			const player = sim.join(client.sessionId, { name, character });
			// Spent only by a join that was let in.
			if (redeemPass(pass, this.game)) player.wonLast = true;
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
			this.held.delete(client.sessionId);
			client.view?.dispose();
			this.syncPlayers();
			if (sim.game.online.nearby) this.nearby();
			this.announce(sim.events(), before);
			void this.listPlayers();
		}

		onBeforePatch() {
			const sim = this.sim;
			if (!sim) return;
			// A respawn may take a bot's place and a bot fill it again: the state follows the room.
			this.syncPlayers();
			this.writeRoom();
			for (const id of sim.players.keys()) this.write(id);
			if (!sim.game.online.nearby) return;
			const started = deps.onNearby ? performance.now() : 0;
			this.holdViews();
			this.nearby();
			deps.onNearby?.(performance.now() - started);
		}

		onDispose() {
			if (this.counted) {
				deps.rooms.count -= 1;
				if (test) test.count -= 1;
			}
			this.counted = false;
		}

		/** The game is won: nobody new joins, and the winner's device is given its pass. */
		private won(sim: RoomSim) {
			void this.lock();
			this.clock.setTimeout(() => void this.disconnect(), WON_ROOM_SECONDS * 1000);
			// A bot's win is no pass: no device played it. A test room's win is none either: a room
			// of three is won at once, and a public room would honour it.
			const won = sim.players.get(sim.rules.winner);
			const winner = won && !won.bot ? this.clients.find((c) => c.sessionId === won.id) : undefined;
			if (winner && this.size === undefined)
				winner.send(ONLINE_EVENT, [{ type: 'winnerPass', pass: issuePass(this.game) }], {
					afterNextPatch: true,
				});
		}

		/** The listing: `game` (and a test room's `size`) is what `filterBy` matches, so every write
		 *  carries it. `players` counts people, not bots: a person can always take a bot's place. */
		private listPlayers() {
			return this.setMetadata({
				game: this.game,
				...(this.size !== undefined ? { size: this.size } : {}),
				players: [...(this.sim?.players.values() ?? [])].filter((p) => !p.bot).length,
				maxPlayers: this.maxClients,
			});
		}

		/** Room player ids each device's view holds, by session (`online.nearby` only). */
		private seen = new Map<string, Set<string>>();

		/** Each device's held view, by session (a box with a `max` only): {@link holdViews}. */
		private held = new Map<string, HeldView>();

		/**
		 * One patch of every device's held view: what its newest input says its screen shows (the
		 * input as it was decoded and sanitized, whether or not a step has taken it), held as
		 * `holdView` holds it for {@link VIEW_HOLD_SECONDS}. A box with no `max` holds none. A
		 * dropped device's is kept as it was, so one that reconnects is sent by it until its first
		 * input says its view again.
		 */
		private holdViews() {
			const { nearby, patchHz } = this.requireSim().game.online;
			if (!nearby?.max) return;
			const patches = Math.round(patchHz * VIEW_HOLD_SECONDS);
			for (const { sessionId } of this.clients) {
				const said = viewRegion(nearby, this.inputs.get(sessionId).latest);
				this.held.set(sessionId, holdView(this.held.get(sessionId), said, patches));
			}
		}

		/**
		 * Each device's view made the players inside the config's `nearby` box around its own player
		 * (itself always) or, with `nearby.max`, inside the view it holds ({@link holdViews}): the
		 * view only adds to the box (`engine-mechanics` `nearbyHolds`), so no device is sent less
		 * than one of a room with no `max`. A player is kept until it is {@link NEARBY_MARGIN} past
		 * both. A pass over every pair: a hundred players is ten thousand tests a patch, each a few
		 * comparisons.
		 */
		private nearby() {
			const sim = this.requireSim();
			const box = sim.game.online.nearby;
			if (!box) return;
			const boxIn = boxRegion(box);
			const boxKeep = boxRegion(box, NEARBY_MARGIN);
			for (const client of this.clients) {
				const view = client.view;
				const seen = this.seen.get(client.sessionId);
				const me = sim.players.get(client.sessionId);
				if (!view || !seen || !me) continue;
				const viewIn = this.held.get(client.sessionId)?.view;
				const viewKeep = pastRegion(viewIn, NEARBY_MARGIN);
				for (const [id, other] of sim.players) {
					const dx = other.body.x - me.body.x;
					const dy = other.body.y - me.body.y;
					const has = seen.has(id);
					const near = id === me.id || nearbyHolds(boxIn, viewIn, dx, dy);
					const player = this.state.players.get(id);
					if (!player) continue;
					if (near && !has) {
						view.add(player, VIEW_TAG.near);
						if (id === me.id) view.add(player, VIEW_TAG.own);
						seen.add(id);
					} else if (has && !near && !nearbyHolds(boxKeep, viewKeep, dx, dy)) {
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
				const held = this.state.players.get(id);
				if (held) {
					// A bot renamed for a person who joined with its name.
					if (held.name !== from.name) held.name = from.name;
					continue;
				}
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
			to.character = from.character.id;
			to.score = from.score;
			to.status = from.status;
			to.mark = from.mark;
			if (from.z !== undefined) to.z = from.z;
			if (from.air !== undefined) {
				to.air = from.air;
				to.carryX = from.carryX ?? 0;
				to.carryY = from.carryY ?? 0;
			}
			to.held = from.status === STATUS.free && (this.sim?.rules.holds(from) ?? false);
			if (from.lineActive !== undefined) {
				to.lineActive = from.lineActive;
				to.lineX = from.lineX ?? 0;
				to.lineY = from.lineY ?? 0;
			}
		}

		private writeRoom() {
			const sim = this.sim;
			if (!sim) return;
			this.state.step = sim.steps;
			this.state.phase = sim.rules.phase;
			this.state.round = sim.rules.round;
			this.state.endsAt = sim.rules.endsAt;
			this.state.winner = sim.rules.winner;
			this.state.winnerName = sim.rules.winnerName;
			this.writeStains();
		}

		/** The rules' new stains pushed onto the state's, and the ones the rules let go shifted off,
		 *  so a patch carries only what changed. */
		private writeStains() {
			const sim = this.sim;
			if (!sim) return;
			const { list, made } = sim.rules.stains;
			const fresh = Math.min(list.length, made - this.stainsWritten);
			if (fresh <= 0) return;
			for (const { x, y } of list.slice(list.length - fresh)) {
				const stain = new Stain();
				stain.x = x;
				stain.y = y;
				this.state.stains.push(stain);
			}
			while (this.state.stains.length > list.length) this.state.stains.shift();
			this.stainsWritten = made;
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
