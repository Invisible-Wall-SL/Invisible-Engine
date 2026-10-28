import type { Room } from 'engine-rooms';
import type { Predict, Reconciler } from 'engine-rooms/predict';
import {
	BUTTONS,
	MOVE_SCALE,
	ONLINE_EVENT,
	STATUS,
	characterBody,
	clampInput,
	createCamera,
	createFixedStep,
	createInterpolator,
	createPredictor,
	createRng,
	createSnapshotClock,
	onlineLevel,
	reconcilerOptions,
	snapFor,
	stepCamera,
	stepContext,
	strongestForce,
	type Camera,
	type FixedStep,
	type Interpolator,
	type OnlineEvent,
	type Predictor,
	type SnapshotClock,
} from 'engine-mechanics';
import { sceneCamera, sceneWorld, worldCameraScene, type Scene } from 'engine-layout';
import { setWorldCameraView, spawnStore } from 'engine-layout/svelte';
import { normalizeGameConfigDoc, onlineGameOf, type OnlineGame } from 'game-config';

import { bakedGameConfig, refuseOnlineBoot } from '../editor-scenes';
import { typingInto } from './flowKeys';

/**
 * THE RUNTIME'S ONLINE BRANCH (`docs/design/realtime-multiplayer.md` §6, §10; P10.14, P10.15) —
 * for an arcade game whose config has `arcade.online` (`ARCADE_ONLINE_MECHANIC`).
 *
 * The boot joins a room on the game server ({@link joinOnlineRoom}, from `+layout.ts`) before the
 * game mounts; `<ArcadeStage />` then ticks {@link tickOnline}: one input a fixed step, read from
 * the keyboard and clamped exactly as the server clamps it, and every player of the room drawn as a
 * spawned instance of its character's component in the play field's spawn layer. The device never
 * decides a place: it sends inputs only. Its own player is PREDICTED (`engine-mechanics`
 * `createPredictor`: stepped at once with the room's own step, reconciled with each state the room
 * sends), and everyone else is INTERPOLATED about 100 ms behind the room (`createSnapshotClock`,
 * `createInterpolator`). Each input names the room step the device was drawing everyone else at
 * (`view`), so an ability is tested against what the player saw.
 *
 * `arcade.online.netcode` picks who predicts the own player: `engine` (the default) is the
 * predictor above; `colyseus` is the SDK's own `Predict` reconciler (`engine-rooms/predict`,
 * awaited and called only then), running the same step (`reconcilerStep`). Everyone else is
 * interpolated the same way in both, so `view` means the same.
 *
 * Launch parameters: `?rooms_url=` the game server (`wss://rooms.invisiblewall.org`), the game
 * key `?rooms_game=` (else `?project=`), and optionally `?rooms_name=` / `?rooms_character=`.
 * `engine-rooms` (`@colyseus/sdk`) is imported only here, on this path, so an offline game never
 * loads it.
 */

/** The game server's room type (`services/game-server/src/server.ts` `ROOM_NAME`). */
const ROOM_NAME = 'arcade';

/** Colyseus' close code for a leave the device asked for. */
const CONSENTED = 4000;

type PlayerState = {
	character: string;
	x: number;
	y: number;
	connected: boolean;
	ack: number;
	status: number;
	score: number;
};
type RoomState = {
	step: number;
	phase: string;
	round: number;
	winner: string;
	players: Map<string, PlayerState>;
};

/** How many of the room's events the probe keeps. */
const EVENTS_KEPT = 32;

type Session = {
	room: Room;
	game: OnlineGame;
	clock: FixedStep;
	seq: number;
	/** The own player, once the room has placed it (`netcode: 'engine'`). */
	me: Predictor | undefined;
	/** The SDK's prediction and its reconciler for the own player (`netcode: 'colyseus'`). */
	sdk: { predict: Predict; me: Reconciler<PlayerState> | undefined } | undefined;
	/** The render clock and tracks for everyone else. */
	view: SnapshotClock;
	others: Interpolator;
	/** The step everyone else was last drawn at. */
	viewStep: number;
	/** Room player id → the instance it is drawn as. */
	drawn: Map<string, string>;
	refused: Set<string>;
	events: OnlineEvent[];
};

let session: Session | undefined;

/** The world camera of an online game whose play field is a world (P10.16): it follows the own
 *  player as it is drawn, so the device's view answers as fast as its controls. */
type OnlineCamera = {
	camera: Camera;
	world: { w: number; h: number } | undefined;
	view: () => Size;
};
type Size = { w: number; h: number };
let worldCamera: OnlineCamera | undefined;

const MOVE_KEYS: Record<string, [number, number]> = {
	ArrowLeft: [-1, 0],
	KeyA: [-1, 0],
	ArrowRight: [1, 0],
	KeyD: [1, 0],
	ArrowUp: [0, -1],
	KeyW: [0, -1],
	ArrowDown: [0, 1],
	KeyS: [0, 1],
};
const BUTTON_KEYS: Record<string, number> = {
	Space: BUTTONS.jump,
	KeyJ: BUTTONS.ability1,
	KeyK: BUTTONS.ability2,
};
const held = new Set<string>();

const onKey = (event: KeyboardEvent) => {
	if (!(event.code in MOVE_KEYS) && !(event.code in BUTTON_KEYS)) return;
	if (event.type === 'keydown' && typingInto(event.target)) return;
	// The arrows and Space would otherwise scroll a page the game sits in.
	event.preventDefault();
	if (event.type === 'keydown') held.add(event.code);
	else held.delete(event.code);
};
const releaseAll = () => held.clear();

/** The input the held keys make, before the clamp. */
const keyInput = (seq: number, view: number) => {
	let x = 0;
	let y = 0;
	let buttons = 0;
	for (const code of held) {
		const move = MOVE_KEYS[code];
		if (move) {
			x += move[0];
			y += move[1];
		}
		buttons |= BUTTON_KEYS[code] ?? 0;
	}
	return {
		seq,
		moveX: Math.sign(x) * MOVE_SCALE,
		moveY: Math.sign(y) * MOVE_SCALE,
		buttons,
		aimX: 0,
		aimY: 0,
		view,
	};
};

/**
 * Join a room of this game, or stop the boot on the error screen saying why: the config cannot be
 * played online, the launch names no server or game, or the server cannot be reached or refused
 * the join (full, unknown character).
 */
export async function joinOnlineRoom(): Promise<void> {
	const resolved = onlineGameOf(normalizeGameConfigDoc(bakedGameConfig()) ?? null);
	if (!resolved) return refuseOnlineBoot('the config is not an online game');
	if ('refused' in resolved) return refuseOnlineBoot(resolved.refused);
	const params = new URLSearchParams(window.location.search);
	const url = params.get('rooms_url');
	const game = params.get('rooms_game') || params.get('project');
	if (!url) return refuseOnlineBoot('the launch names no game server (?rooms_url=)');
	if (!game) return refuseOnlineBoot('the launch names no game (?rooms_game=)');
	let room: Room | undefined;
	let predict: Predict | undefined;
	try {
		const { Client } = await import('engine-rooms');
		const sdk =
			resolved.online.netcode === 'colyseus' ? await import('engine-rooms/predict') : null;
		room = await new Client(url).joinOrCreate(ROOM_NAME, {
			game,
			name: params.get('rooms_name') ?? undefined,
			character: params.get('rooms_character') ?? undefined,
		});
		predict = sdk?.Predict.get(room);
	} catch (error) {
		room?.leave().catch(() => {});
		return refuseOnlineBoot(
			`the game server did not let it in (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	// A room that is gone for good (disposed, a kick, a reconnect that ran out) leaves nothing to
	// play: say so on the same screen rather than freeze on the last state.
	room.onLeave((code: number) => {
		session = undefined;
		predict?.dispose();
		if (code !== CONSENTED) void refuseOnlineBoot(`the room closed (code ${code})`, true);
	});
	const current: Session = {
		room,
		game: resolved,
		clock: createFixedStep({ hz: resolved.online.tickHz }),
		seq: 0,
		me: undefined,
		sdk: predict && { predict, me: undefined },
		view: createSnapshotClock({ stepMs: 1000 / resolved.online.tickHz }),
		others: createInterpolator({
			snapPx: snapFor(
				Math.max(...resolved.online.characters.map((c) => c.speed)) +
					strongestForce(resolved.online.rules.zones),
				resolved.online.patchHz,
			),
		}),
		viewStep: 0,
		drawn: new Map(),
		refused: new Set(),
		events: [],
	};
	session = current;
	room.onStateChange(() => received(current, performance.now()));
	room.onMessage(ONLINE_EVENT, (events: OnlineEvent[]) => {
		current.events.push(...events);
		current.events.splice(0, current.events.length - EVENTS_KEPT);
	});
}

/** The own player's predictor, from its first place in the room. */
function predictorOf(current: Session, player: PlayerState): Predictor | undefined {
	const { game } = current;
	const character = game.online.characters.find((c) => c.id === player.character);
	if (!character) return undefined;
	return createPredictor({
		body: characterBody(current.room.sessionId, game.bodies[character.body], player),
		speed: character.speed,
		ctx: stepContext(game.online.tickHz, game.online.subSteps),
		field: game.field,
		level: onlineLevel(game.zones, game.online.rules.zones, character.id, game.field),
		ack: player.ack,
		snapPx: snapFor(character.speed + strongestForce(game.online.rules.zones), game.online.patchHz),
	});
}

/** The own player's reconciler under `netcode: 'colyseus'`: the SDK's, over the room's step. */
function reconcilerOf(
	current: Session,
	predict: Predict,
	player: PlayerState,
): Reconciler<PlayerState> | undefined {
	const options = reconcilerOptions(current.game, current.room.sessionId, player);
	return options && predict.reconciler(player, { input: current.room.input(), ...options });
}

/** A state from the room: the own player reconciled, everyone else's place recorded at its step. */
function received(current: Session, nowMs: number) {
	const state = stateOf(current.room);
	const players = state.players;
	if (!players || state.step === undefined) return;
	current.view.observe(state.step, nowMs);
	current.others.retain(new Set(players.keys()));
	players.forEach((player, id) => {
		if (id !== current.room.sessionId) {
			current.others.push(id, state.step!, player.x, player.y);
			return;
		}
		// The SDK reconciles on its own, from the input acknowledgement each state carries.
		if (current.sdk) {
			current.sdk.me ??= reconcilerOf(current, current.sdk.predict, player);
			return;
		}
		current.me ??= predictorOf(current, player);
		current.me?.reconcile({
			x: player.x,
			y: player.y,
			ack: player.ack,
			still: player.status !== STATUS.free,
			step: state.step,
		});
	});
}

/** Start reading the keyboard; returns the stop. */
export function listenOnline(): () => void {
	window.addEventListener('keydown', onKey);
	window.addEventListener('keyup', onKey);
	window.addEventListener('blur', releaseAll);
	return () => {
		window.removeEventListener('keydown', onKey);
		window.removeEventListener('keyup', onKey);
		window.removeEventListener('blur', releaseAll);
		releaseAll();
	};
}

/** The room's synced state, in the shape `services/game-server/src/schema.ts` declares. */
const stateOf = (room: Room): Partial<RoomState> => room.state as Partial<RoomState>;

/** Where the own player is drawn, by whichever netcode predicts it; `undefined` until placed. */
function ownPlace(current: Session) {
	const sdk = current.sdk?.me;
	if (sdk) return { x: sdk.value('x'), y: sdk.value('y') };
	return current.me?.drawn(current.clock.alpha);
}

/** Where a player is drawn: the own one predicted, everyone else between the room's states. */
function placeOf(current: Session, id: string, player: PlayerState) {
	const own = id === current.room.sessionId ? ownPlace(current) : undefined;
	if (own) return own;
	return current.others.at(id, current.viewStep) ?? { x: player.x, y: player.y };
}

/** Put every player of the room where it is drawn. */
function draw(current: Session) {
	const live = spawnStore();
	const { layer } = current.game.online;
	const players = stateOf(current.room).players;
	if (!players) return;
	for (const [id, instance] of current.drawn) {
		if (!players.has(id)) {
			live.despawn(instance);
			current.drawn.delete(id);
		}
	}
	const moves: { id: string; x: number; y: number }[] = [];
	players.forEach((player, id) => {
		const at = placeOf(current, id, player);
		const instance = current.drawn.get(id);
		if (instance) {
			moves.push({ id: instance, x: at.x, y: at.y });
			return;
		}
		const character = current.game.online.characters.find((c) => c.id === player.character);
		if (!character) return;
		const spawned = live.spawn(layer, character.body, at);
		if (spawned.ok) current.drawn.set(id, spawned.instance.id);
		else if (!current.refused.has(character.body)) {
			current.refused.add(character.body);
			console.warn(
				`[online] cannot draw "${character.body}" in the layer "${layer}" (${spawned.reason})`,
			);
		}
	});
	live.move(moves);
}

/**
 * Give an online game the camera of the layout's world screen, if it has one (as the offline loop's
 * `useWorldCamera`); the first world screen seen is kept for the page. `view` reads the current
 * design size, so a rotated device moves the view with it.
 */
export function useOnlineCamera(scenes: readonly Scene[], view: () => Size) {
	if (worldCamera) return;
	const scene = worldCameraScene(scenes);
	if (!scene) return;
	const camera = createCamera(sceneCamera(scene), createRng('online:camera'));
	camera.snapNext = true;
	worldCamera = { camera, world: sceneWorld(scene), view };
}

/** Move the camera after a frame, towards the own player as drawn. */
function follow(current: Session, dtMs: number) {
	const at = worldCamera && ownPlace(current);
	if (!worldCamera || !at) return;
	const { camera, world, view } = worldCamera;
	stepCamera(camera, dtMs / 1000, { view: view(), world, target: { ...at, vx: 0, vy: 0 } });
	setWorldCameraView({ x: camera.x, y: camera.y, shakeX: camera.offsetX, shakeY: camera.offsetY });
}

/** One frame: the inputs its fixed steps hold, each predicted as it is sent, then the room drawn. */
export function tickOnline(dtMs: number) {
	const current = session;
	if (!current) return;
	const now = performance.now();
	current.viewStep = current.view.advance(now) ?? current.viewStep;
	// The SDK's order: reconcile and decay, then send (its reconciler steps each send), then read.
	current.sdk?.predict.tick(now);
	current.clock.advance(dtMs, () => {
		current.seq += 1;
		const raw = keyInput(current.seq, Math.max(0, Math.floor(current.viewStep)));
		const input = clampInput(raw, current.game.field);
		const handle = current.room.input();
		Object.assign(handle.data, input);
		handle.send();
		current.me?.input(input);
	});
	current.me?.frame(dtMs);
	draw(current);
	follow(current, dtMs);
}

/** The room as the determinism probe reads it: the server's step and places, and how each player is
 *  drawn. */
export function onlineProbe() {
	const current = session;
	const state = current ? stateOf(current.room) : undefined;
	const bodies: { id: string; x: number; y: number; vx: number; vy: number; tags: string[] }[] = [];
	const drawn: { id: string; x: number; y: number }[] = [];
	state?.players?.forEach((p, id) => {
		bodies.push({ id, x: p.x, y: p.y, vx: 0, vy: 0, tags: [] });
		if (current) drawn.push({ id, ...placeOf(current, id, p) });
	});
	const camera = worldCamera?.camera;
	return {
		steps: state?.step || 0,
		bodies,
		...(camera && worldCamera
			? {
					camera: {
						x: camera.x,
						y: camera.y,
						shakeX: camera.offsetX,
						shakeY: camera.offsetY,
						view: worldCamera.view(),
					},
				}
			: {}),
		...(current && state
			? {
					online: {
						me: current.room.sessionId,
						drawn,
						viewStep: current.viewStep,
						netcode: current.game.online.netcode,
						...(current.sdk
							? {}
							: { corrections: current.me?.corrections ?? 0, snaps: current.me?.snaps ?? 0 }),
						phase: state.phase ?? '',
						round: state.round ?? 0,
						winner: state.winner ?? '',
						scores: Object.fromEntries(
							[...(state.players ?? new Map<string, PlayerState>())].map(([id, p]) => [
								id,
								p.score,
							]),
						),
						events: [...current.events],
					},
				}
			: {}),
	};
}
