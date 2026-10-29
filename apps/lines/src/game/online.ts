import type { Room } from 'engine-rooms';
import type { Predict, Reconciler } from 'engine-rooms/predict';
import {
	BUTTONS,
	MOVE_SCALE,
	ONLINE_EVENT,
	STATUS,
	abilitySignal,
	characterBody,
	clampInput,
	createAbilityPredictor,
	createCamera,
	createFixedStep,
	flowSignalsOf,
	serverValuesOf,
	shownInRoom,
	type AbilityPredictor,
	type OnlineFlowSignal,
	createInterpolator,
	createPredictor,
	createRng,
	createSnapshotClock,
	generatedOnlineGame,
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
import { serverVariablesOf } from 'engine-flow-v2';
import {
	FIELD_DRAWINGS,
	sceneCamera,
	sceneWorld,
	worldCameraScene,
	type LayoutDoc,
	type LayoutNode,
	type Scene,
} from 'engine-layout';
import { setWorldCameraView, spawnStore } from 'engine-layout/svelte';
import { normalizeGameConfigDoc, onlineGameOf, type OnlineGame } from 'game-config';

import {
	bakedFlowV2Doc,
	bakedGameConfig,
	refuseOnlineBoot,
	setRoomDocChange,
} from '../editor-scenes';
import { typingInto } from './flowKeys';
import { getFlowV2 } from './flowV2InterpreterHolder';

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
 * FLOW (P11.2): the room's events reach the flow as its online events (`flowSignalsOf`), and the
 * room's scores and round are written, on each state, into the variables the flow declares the
 * room owns (`FlowVariable.server`), which its HUD binds as `var:<id>`. The own player's abilities
 * are raised on the press (`createAbilityPredictor`), not when the room answers, so a swipe is
 * drawn at once. A player that is out is not drawn until it respawns.
 *
 * A FIELD PER ROOM (P11.2 (e)): when the config names a generator (`arcade.online.generator`),
 * the join waits for the room's first state, makes the room's own field from the seed it carries
 * (`generatedOnlineGame`, the very function the server ran) and draws it in place of the authored
 * one ({@link withRoomField}, `FIELD_DRAWINGS`), as the scenes load.
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
	endsAt: number;
	winner: string;
	/** The room's seed, from which a generated field is made (P11.2 (e)). */
	seed: number;
	players: Map<string, PlayerState>;
};

/** How long a join waits for the room's first state, which carries the seed of its field. */
const SEED_WAIT_MS = 5000;

/** How many of the room's events, and of the flow signals raised, the probe keeps. */
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
	/** The own player's abilities, raised on the press; made with its first place. */
	abilities: AbilityPredictor | undefined;
	/** The flow signals raised, newest last (the probe's). */
	signals: OnlineFlowSignal[];
	/** The flow's variables the room writes, read once the flow is up. */
	serverVariables: { id: string; server: string }[] | undefined;
	/** The room's seed, and the field made from it, drawn in place of the authored node of its id. */
	seed: number | undefined;
	field: LayoutNode | undefined;
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
	const generator = resolved.online.generator;
	const seed = generator ? await roomSeed(room) : undefined;
	if (generator && seed === undefined) {
		room.leave().catch(() => {});
		return refuseOnlineBoot('the room did not say which field it plays');
	}
	const played =
		seed === undefined ? { game: resolved, made: undefined } : generatedOnlineGame(resolved, seed);
	const draw = generator ? FIELD_DRAWINGS[generator] : undefined;
	const current: Session = {
		room,
		game: played.game,
		clock: createFixedStep({ hz: resolved.online.tickHz }),
		seq: 0,
		me: undefined,
		sdk: predict && { predict, me: undefined },
		view: createSnapshotClock({ stepMs: 1000 / resolved.online.tickHz }),
		others: createInterpolator({
			snapPx: snapFor(
				Math.max(...resolved.online.characters.map((c) => c.speed)) +
					strongestForce(played.game.online.rules.zones),
				resolved.online.patchHz,
			),
		}),
		viewStep: 0,
		drawn: new Map(),
		refused: new Set(),
		events: [],
		abilities: undefined,
		signals: [],
		serverVariables: undefined,
		seed,
		field: played.made && draw?.(played.made),
	};
	session = current;
	if (current.field) setRoomDocChange(withRoomField);
	room.onStateChange(() => received(current, performance.now()));
	room.onMessage(ONLINE_EVENT, (events: OnlineEvent[]) => {
		current.events.push(...events);
		current.events.splice(0, current.events.length - EVENTS_KEPT);
		const players = stateOf(current.room).players;
		for (const signal of flowSignalsOf(
			events,
			current.room.sessionId,
			(id) => {
				const player = players?.get(id);
				return player && { ...placeOf(current, id, player), character: player.character };
			},
			current.abilities,
		))
			raise(current, signal);
	});
}

/** The seed the room's first state carries, or `undefined` if none comes in time. */
function roomSeed(room: Room): Promise<number | undefined> {
	const now = (room.state as Partial<RoomState> | undefined)?.seed;
	if (typeof now === 'number') return Promise.resolve(now);
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(undefined), SEED_WAIT_MS);
		room.onStateChange.once((state: Partial<RoomState>) => {
			clearTimeout(timer);
			resolve(typeof state.seed === 'number' ? state.seed : undefined);
		});
	});
}

/**
 * `doc` with the room's own field drawn in place of the authored node of the same id, in every
 * scene; `doc` itself when the room plays the field as authored (or there is no room). The loaded
 * doc passes through it (`editor-scenes` `loadEditorScenes`) once a room made its own field.
 */
function withRoomField(doc: LayoutDoc): LayoutDoc {
	const field = session?.field;
	if (!field) return doc;
	return {
		...doc,
		scenes: doc.scenes.map((scene) =>
			scene.nodes.some((node) => node.id === field.id)
				? { ...scene, nodes: scene.nodes.map((node) => (node.id === field.id ? field : node)) }
				: scene,
		),
	};
}

/** Raise a room event in the flow (an online event). */
function raise(current: Session, signal: OnlineFlowSignal) {
	current.signals.push(signal);
	current.signals.splice(0, current.signals.length - EVENTS_KEPT);
	void getFlowV2()?.dispatch(signal.name, signal.payload);
}

/** Write the room's values into the flow's variables the room owns; the next frame delivers them. */
function bindServerVariables(current: Session, state: Partial<RoomState>) {
	const store = getFlowV2()?.state;
	if (!store) return;
	current.serverVariables ??= serverVariablesOf(bakedFlowV2Doc() ?? {});
	if (!current.serverVariables.length) return;
	const values: Record<string, unknown> = serverValuesOf(
		state,
		current.room.sessionId,
		current.game.online.tickHz,
	);
	for (const { id, server } of current.serverVariables) store.write(id, values[server]);
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
	bindServerVariables(current, state);
	current.others.retain(new Set(players.keys()));
	players.forEach((player, id) => {
		if (id !== current.room.sessionId) {
			current.others.push(id, state.step!, player.x, player.y);
			return;
		}
		current.abilities ??= createAbilityPredictor(current.game, player.character);
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
		const player = players.get(id);
		if (!player || !shownInRoom(player)) {
			live.despawn(instance);
			current.drawn.delete(id);
		}
	}
	const moves: { id: string; x: number; y: number }[] = [];
	players.forEach((player, id) => {
		if (!shownInRoom(player)) return;
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

/** Raise the own player's abilities the input uses, on the press: drawn before the room answers. */
function predictAbilities(current: Session, buttons: number) {
	const state = stateOf(current.room);
	const me = state.players?.get(current.room.sessionId);
	if (!current.abilities || !me) return;
	const free = state.phase === 'running' && me.status === STATUS.free;
	const at = ownPlace(current);
	for (const button of current.abilities.step(buttons, free))
		raise(
			current,
			abilitySignal(
				current.room.sessionId,
				button,
				current.room.sessionId,
				at && { ...at, character: me.character },
				true,
			),
		);
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
		predictAbilities(current, input.buttons);
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
	const hidden: string[] = [];
	state?.players?.forEach((p, id) => {
		bodies.push({ id, x: p.x, y: p.y, vx: 0, vy: 0, tags: [] });
		if (!shownInRoom(p)) hidden.push(id);
		else if (current) drawn.push({ id, ...placeOf(current, id, p) });
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
						seed: current.seed ?? null,
						zones: current.game.zones.map((z) => [z.id, z.x, z.y, z.w, z.h]),
						field: current.field?.id ?? null,
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
						hidden,
						signals: current.signals.map((s) => ({ ...s })),
						spawned: spawnStore()
							.live(current.game.online.layer)
							.map((instance) => instance.componentId),
					},
				}
			: {}),
	};
}
