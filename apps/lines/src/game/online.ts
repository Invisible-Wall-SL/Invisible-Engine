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
	createHookLines,
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
	type HookLines,
	type Interpolator,
	type OnlineEvent,
	type Predictor,
	type SnapshotClock,
} from 'engine-mechanics';
import { serverVariablesOf } from 'engine-flow-v2';
import {
	CHARACTER_CLIP_EVENTS,
	FIELD_DRAWINGS,
	createCharacterAnimator,
	flipbookCycleMs,
	getComponent,
	resolveFlipbook,
	sceneCamera,
	sceneWorld,
	worldCameraScene,
	type CharacterAnimator,
	type CharacterClipEvent,
	type CharacterClipFrame,
	type CharacterClips,
	type LayoutDoc,
	type LayoutNode,
	type Scene,
} from 'engine-layout';
import {
	clearClips,
	clearMarks,
	clipsOn,
	setClips,
	setLinks,
	setMarks,
	startMarks,
	setWorldCameraView,
	spawnStore,
	type InstanceClip,
	type InstanceLink,
	type InstanceMark,
} from 'engine-layout/svelte';
import { normalizeGameConfigDoc, onlineGameOf, type OnlineGame } from 'game-config';

import {
	bakedFlowV2Doc,
	bakedGameConfig,
	preparedEditorDoc,
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
 * drawn at once. A player that is out is not drawn until it respawns. A player the room marks
 * (`mark`: Salmons' golden salmon) is drawn gold, and a `hook` ability's line is drawn from the
 * player holding it to the one on it while that one is `hooked` (`createHookLines`), both from the
 * state every frame, so every device shows them as soon as the room changes them.
 *
 * CLIPS (Salmons' S0 art): a character whose component has `characterClips` plays its Invisible
 * Flipbook clips once they are registered (`engine-layout` `characterClips.ts`): its loop from how
 * it moves as drawn and whether its line holds a player, and a one-shot on a room event about it
 * (a hop, a swipe, a cast, a catch). One caught by the room is still drawn while its catch plays.
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
	mark: boolean;
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
	/** Character id → its body's size on the ground (what sizes a glow and lifts a line's ends). */
	sizes: Map<string, { w: number; h: number }>;
	/** The fishing lines the room's events tell of. */
	lines: HookLines;
	/** The lines drawn, room ids (the probe's). */
	drawnLines: { by: string; target: string }[];
	/** The own player's abilities, raised on the press; made with its first place. */
	abilities: AbilityPredictor | undefined;
	/** The flow signals raised, newest last (the probe's). */
	signals: OnlineFlowSignal[];
	/** Room player id → how its clips play (only for a character whose component has clips). */
	looks: Map<string, PlayerLook>;
	/** Component id → its clips, or `null` when it has none; read once each is registered. */
	clipLooks: Map<string, CharacterClips | null>;
	/** The clock the clips play by: the frames' time, in ms. */
	clipClock: number;
	/** The clips drawn as they changed, `<room id>:<clip id>`, newest last (the probe's). */
	clipLog: string[];
	/** The flow's variables the room writes, read once the flow is up. */
	serverVariables: { id: string; server: string }[] | undefined;
	/** The room's seed, and the field made from it, drawn in place of the authored node of its id. */
	seed: number | undefined;
	field: LayoutNode | undefined;
	/** Whether the loaded doc drew {@link field}: `undefined` until the scenes load. */
	fieldDrawn: boolean | undefined;
};

let session: Session | undefined;

/** A player's clips: its animator, its drawn places of the last moment (its velocity) and, once
 *  the room put it out, how long its instance is kept for its catch. */
type PlayerLook = {
	look: CharacterClips;
	animator: CharacterAnimator;
	trail: { x: number; y: number; atMs: number }[];
	leaving: number | undefined;
	shown: CharacterClipFrame | undefined;
};

/** How long an instance put out is kept waiting for the room's `caught`, which comes just after
 *  the state that put it out. */
const CAUGHT_WAIT_MS = 400;

/** How far back a character's velocity is measured: over a frame, a prediction's correction or an
 *  interpolation's step would turn its facing for that frame alone. */
const VELOCITY_WINDOW_MS = 150;

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
		clearMarks();
		clearClips();
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
	const field = played.made && draw?.(played.made);
	const prepared = preparedEditorDoc();
	if (field && prepared && !holdsNode(prepared, field.id)) {
		room.leave().catch(() => {});
		return refuseOnlineBoot(missingFieldNode(field.id));
	}
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
		sizes: new Map(
			played.game.online.characters.map((c) => [c.id, sizeOf(played.game.bodies[c.body])]),
		),
		lines: createHookLines(),
		drawnLines: [],
		abilities: undefined,
		looks: new Map(),
		clipLooks: new Map(),
		clipClock: 0,
		clipLog: [],
		signals: [],
		serverVariables: undefined,
		seed,
		field,
		fieldDrawn: undefined,
	};
	session = current;
	// Before the game mounts and anything is spawned, so no look is remounted to be wrapped.
	startMarks();
	if (current.field) setRoomDocChange(withRoomField);
	room.onStateChange(() => received(current, performance.now()));
	room.onMessage(ONLINE_EVENT, (events: OnlineEvent[]) => {
		current.events.push(...events);
		current.events.splice(0, current.events.length - EVENTS_KEPT);
		current.lines.events(events);
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
		const first = (state: Partial<RoomState>) => {
			clearTimeout(timer);
			resolve(typeof state.seed === 'number' ? state.seed : undefined);
		};
		const timer = setTimeout(() => {
			room.onStateChange.remove(first);
			resolve(undefined);
		}, SEED_WAIT_MS);
		room.onStateChange.once(first);
	});
}

/** Whether a screen of `doc` has a top-level node `id`, where a generated field is drawn. */
const holdsNode = (doc: LayoutDoc, id: string) =>
	doc.scenes.some((scene) => scene.nodes.some((node) => node.id === id));

/** Why a generator game with no node to draw its room's field in does not start. */
const missingFieldNode = (id: string) =>
	`the layout has no node "${id}" to draw the room's own field in: keep a node with id ` +
	`"${id}", or remove arcade.online.generator`;

/**
 * `doc` with the room's own field drawn in place of the authored node of the same id, in every
 * scene, and that scene's world sized to the room's field; `doc` itself when the room plays the
 * field as authored (or there is no room). The loaded doc passes through it (`editor-scenes`
 * `loadEditorScenes`) once a room made its own field. A layout with no node of that id would
 * draw the authored field over the room's own: the join refuses it before the game mounts when the
 * layout is already in hand, and here (a layout fetched at mount) the device leaves the room.
 */
function withRoomField(doc: LayoutDoc): LayoutDoc {
	const current = session;
	const field = current?.field;
	if (!current || !field) return doc;
	const size = current.game.field;
	const holds = (scene: Scene) => scene.nodes.some((node) => node.id === field.id);
	current.fieldDrawn = holdsNode(doc, field.id);
	if (!current.fieldDrawn) {
		current.room.leave().catch(() => {});
		void refuseOnlineBoot(missingFieldNode(field.id), true);
		return doc;
	}
	return {
		...doc,
		scenes: doc.scenes.map((scene) =>
			holds(scene)
				? {
						...scene,
						...(scene.world ? { world: { w: size.w, h: size.h } } : {}),
						nodes: scene.nodes.map((node) => (node.id === field.id ? field : node)),
					}
				: scene,
		),
	};
}

/** The player a signal's one-shot clip is about, for the events a look plays on. */
function clipSubject(signal: OnlineFlowSignal): CharacterClipEvent | undefined {
	return (CHARACTER_CLIP_EVENTS as readonly string[]).includes(signal.name)
		? (signal.name as CharacterClipEvent)
		: undefined;
}

/** Raise a room event in the flow (an online event), and start the one-shot clip it plays. */
function raise(current: Session, signal: OnlineFlowSignal) {
	current.signals.push(signal);
	current.signals.splice(0, current.signals.length - EVENTS_KEPT);
	const event = clipSubject(signal);
	if (event) {
		const subject = event === 'caught' ? signal.payload.target : signal.payload.player;
		if (typeof subject === 'string') current.looks.get(subject)?.animator.event(event);
	}
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
		current.abilities.acked(player.ack);
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
function draw(current: Session, dtMs: number) {
	const live = spawnStore();
	const { layer } = current.game.online;
	const players = stateOf(current.room).players;
	if (!players) return;
	current.clipClock += dtMs;
	for (const id of current.looks.keys()) if (!players.has(id)) current.looks.delete(id);
	for (const [id, instance] of current.drawn) {
		const player = players.get(id);
		if (player && (shownInRoom(player) || keptForCatch(current, id, player))) continue;
		live.despawn(instance);
		current.drawn.delete(id);
		const look = current.looks.get(id);
		if (look) {
			look.leaving = undefined;
			look.trail.length = 0;
		}
	}
	const moves: { id: string; x: number; y: number }[] = [];
	const places = new Map<string, { x: number; y: number }>();
	players.forEach((player, id) => {
		if (!shownInRoom(player)) return;
		const at = placeOf(current, id, player);
		places.set(id, at);
		const instance = current.drawn.get(id);
		if (instance) {
			moves.push({ id: instance, x: at.x, y: at.y });
			const look = current.looks.get(id);
			if (look) look.leaving = undefined;
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
	drawMarks(current, players);
	drawClips(current, players, places);
}

/** The registered clips, as a character's animator reads them. */
const CLIP_SOURCE = {
	has: (clipId: string) => resolveFlipbook(clipId) !== undefined,
	cycleMs: (clipId: string) => flipbookCycleMs(clipId, false),
};

/** A component's clips, read once it is registered (the game registers its components as it
 *  mounts, after the join). */
function clipLookOf(current: Session, componentId: string): CharacterClips | undefined {
	if (current.clipLooks.has(componentId)) return current.clipLooks.get(componentId) ?? undefined;
	const def = getComponent(componentId);
	if (!def) return undefined;
	current.clipLooks.set(componentId, def.characterClips ?? null);
	return def.characterClips;
}

/** A player's clips, made with its first draw; `undefined` for a character with none. */
function lookOf(current: Session, id: string, player: PlayerState): PlayerLook | undefined {
	const known = current.looks.get(id);
	if (known) return known;
	const character = current.game.online.characters.find((c) => c.id === player.character);
	const look = character && clipLookOf(current, character.body);
	if (!look) return undefined;
	const made: PlayerLook = {
		look,
		animator: createCharacterAnimator(look, CLIP_SOURCE),
		trail: [],
		leaving: undefined,
		shown: undefined,
	};
	current.looks.set(id, made);
	return made;
}

/**
 * Whether a player the room put out is still drawn: while its catch plays. The room's `caught`
 * comes just after the state that put it out, so it is waited for a moment; a character with no
 * `caught` clip is hidden at once, as before.
 */
function keptForCatch(current: Session, id: string, player: PlayerState): boolean {
	const look = current.looks.get(id);
	if (!look || !look.animator.plays('caught', player.mark)) return false;
	const now = current.clipClock;
	look.leaving ??= now + CAUGHT_WAIT_MS;
	return now < look.leaving || look.animator.busy(now);
}

/** Each drawn character's clip this frame, from how it moved as drawn since the last one. */
function drawClips(
	current: Session,
	players: Map<string, PlayerState>,
	places: Map<string, { x: number; y: number }>,
) {
	const holders = new Set(current.lines.drawn(players).map((line) => line.by));
	const clips = new Map<string, InstanceClip>();
	const now = current.clipClock;
	for (const [id, instance] of current.drawn) {
		const player = players.get(id);
		const look = player && lookOf(current, id, player);
		if (!player || !look) continue;
		const { trail } = look;
		const at = places.get(id) ?? trail.at(-1) ?? placeOf(current, id, player);
		trail.push({ x: at.x, y: at.y, atMs: now });
		while (trail.length > 2 && now - trail[1].atMs >= VELOCITY_WINDOW_MS) trail.shift();
		const from = trail[0];
		const dt = now - from.atMs;
		const vx = dt > 0 ? ((at.x - from.x) * 1000) / dt : 0;
		const vy = dt > 0 ? ((at.y - from.y) * 1000) / dt : 0;
		const frame = look.animator.frame({
			atMs: now,
			vx,
			vy,
			holding: holders.has(id),
			marked: player.mark,
		});
		if (frame?.clipId !== look.shown?.clipId) {
			current.clipLog.push(`${id}:${frame?.clipId ?? ''}`);
			current.clipLog.splice(0, current.clipLog.length - EVENTS_KEPT);
		}
		look.shown = frame;
		if (!frame) continue;
		clips.set(instance, {
			clipId: frame.clipId,
			flipX: frame.flipX,
			loop: frame.loop,
			play: frame.play,
			width: look.look.displayWidth,
			anchorY: look.look.anchorY ?? 1,
			own: frame.marked,
		});
	}
	if (current.looks.size || clipsOn()) setClips(clips);
}

/** A body's size on the ground: a box's, or a circle's diameter. */
const sizeOf = (spec: OnlineGame['bodies'][string] | undefined) =>
	spec?.shape === 'box'
		? { w: spec.w, h: spec.h }
		: spec?.shape === 'circle'
			? { w: spec.r * 2, h: spec.r * 2 }
			: { w: 0, h: 0 };

/** The body of the player's character. */
const bodyOf = (current: Session, player: PlayerState) =>
	current.sizes.get(player.character) ?? { w: 0, h: 0 };

/**
 * The marked players drawn gold, and the fishing lines from holder to hooked, as drawn. A line's
 * ends are raised by the bodies' `h`, which in an isometric world is their depth on the ground, not
 * a look's height: right while the looks are sized to their bodies (Salmons' placeholders).
 */
function drawMarks(current: Session, players: Map<string, PlayerState>) {
	const marks = new Map<string, InstanceMark>();
	for (const [id, instance] of current.drawn) {
		const player = players.get(id);
		if (player?.mark) marks.set(instance, { width: bodyOf(current, player).w });
	}
	setMarks(marks);
	const links: InstanceLink[] = [];
	current.drawnLines = [];
	for (const line of current.lines.drawn(players)) {
		const from = current.drawn.get(line.by);
		const to = current.drawn.get(line.target);
		const by = players.get(line.by);
		const target = players.get(line.target);
		if (!from || !to || !by || !target) continue;
		current.drawnLines.push(line);
		links.push({
			from,
			to,
			fromLift: bodyOf(current, by).h * 0.75,
			toLift: bodyOf(current, target).h / 2,
		});
	}
	setLinks(current.game.online.layer, links);
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
	const size = view();
	stepCamera(camera, dtMs / 1000, { view: size, world, target: { ...at, vx: 0, vy: 0 } });
	setWorldCameraView({
		x: camera.x,
		y: camera.y,
		shakeX: camera.offsetX,
		shakeY: camera.offsetY,
		view: size,
	});
}

/** Raise the own player's abilities the input uses, on the press: drawn before the room answers. */
function predictAbilities(current: Session, buttons: number, seq: number) {
	const state = stateOf(current.room);
	const me = state.players?.get(current.room.sessionId);
	if (!current.abilities || !me) return;
	const free = state.phase === 'running' && me.status === STATUS.free;
	const at = ownPlace(current);
	for (const button of current.abilities.step(buttons, free, seq))
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
		predictAbilities(current, input.buttons, input.seq);
	});
	current.me?.frame(dtMs);
	draw(current, dtMs);
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
						fieldDrawn: current.fieldDrawn ?? null,
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
						marked: [...(state.players ?? new Map<string, PlayerState>())]
							.filter(([id, p]) => p.mark && current.drawn.has(id))
							.map(([id]) => id),
						lines: current.drawnLines.map((line) => ({ ...line })),
						clips: Object.fromEntries(
							[...current.looks].flatMap(([id, { shown }]) =>
								shown && current.drawn.has(id)
									? [[id, { clipId: shown.clipId, flipX: shown.flipX }]]
									: [],
							),
						),
						clipLog: [...current.clipLog],
						signals: current.signals.map((s) => ({ ...s })),
						spawned: spawnStore()
							.live(current.game.online.layer)
							.map((instance) => instance.componentId),
					},
				}
			: {}),
	};
}
