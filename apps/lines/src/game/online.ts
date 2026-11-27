import { flushSync } from 'svelte';

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
	cameraZoom,
	createCamera,
	createFixedStep,
	createHookLines,
	flowSignalsOf,
	serverValuesOf,
	shownInRoom,
	shownOf,
	type AbilityPredictor,
	type OnlineFlowSignal,
	createInterpolator,
	createPointerTracker,
	createPredictor,
	createPressLatch,
	createRespawnAsk,
	createRng,
	createSnapshotClock,
	createTouchControl,
	launchJoin,
	mobileDevice,
	onlineLevel,
	pointerMove,
	reconcilerOptions,
	roomLevelGame,
	snapFor,
	stepCamera,
	stepContext,
	strongestForce,
	zoomedView,
	type Camera,
	type FixedStep,
	type HookLine,
	type HookLines,
	type Interpolator,
	type OnlineEvent,
	type PointerTracker,
	type Predictor,
	type RespawnAsk,
	type RoomLevelRefusal,
	type RoomLevelReport,
	type Shown,
	type SnapshotClock,
	type TouchControl,
} from 'engine-mechanics';
import { serverVariablesOf } from 'engine-flow-v2';
import {
	CHARACTER_CLIP_EVENTS,
	FIELD_DRAWINGS,
	SALMONS_CHARACTER_CLIPS,
	characterClipsIn,
	clipBox,
	clipPoints,
	createCharacterAnimator,
	createSheetAnimator,
	createSheetRigAnimator,
	flipbookCycleMs,
	getComponent,
	leanedPoint,
	registerFlipbooks,
	resolveFlipbook,
	sceneCamera,
	sceneCameraZoom,
	sceneProjector,
	screenToWorldDirection,
	sceneWorld,
	sheetClipPoints,
	sheetDraw,
	sheetPlaysClips,
	sheetPlaysRig,
	sheetSignalsOf,
	sheetStillClips,
	sheetLeanPivot,
	sheetTurns,
	worldCameraScene,
	type CharacterAnimator,
	type CharacterClipEvent,
	type CharacterClipFrame,
	type CharacterClips,
	type IsoProjector,
	type LayoutDoc,
	type LayoutNode,
	type SalmonsRiverDrawing,
	type Scene,
	type SheetAnimator,
	type SheetRigAnimator,
	type SheetRigFrame,
	type SheetSignal,
} from 'engine-layout';
import {
	clearArt,
	clearClips,
	clearMarks,
	clipsOn,
	depthOf,
	setClips,
	setCodeLooks,
	setDepths,
	setFieldArt,
	setLinks,
	setMarks,
	startMarks,
	setWorldCameraView,
	setWorldProjector,
	setWorldZoom,
	spawnLayerPoint,
	spawnStore,
	worldCameraView,
	type ArtMount,
	type InstanceClip,
	type InstanceLink,
	type InstanceMark,
} from 'engine-layout/svelte';
import type {
	CodeLook,
	SalmonsArt,
	SalmonsBridges,
	SalmonsScreenHost,
	SalmonsStartHost,
	SalmonsZoneArt,
	StainList,
} from 'engine-layout/salmons-art';
import { createSheetClipLook, type SheetClipLook } from 'engine-layout/sheet-clip';
import type { SheetRigLook } from 'engine-layout/sheet-rig';
import {
	SALMONS_ART_GENERATORS,
	normalizeGameConfigDoc,
	onlineClassSheetOf,
	onlineGameOf,
	withOnlineSlide,
	salmonsProjectSheetOf,
	shapedOnlineGame,
	touchSchemeOf,
	onlineStainsOf,
	type CharacterSheet,
	type OnlineGame,
	type ResolvedTouchScheme,
} from 'game-config';

import {
	AUTHORING_PARAM,
	bakedCinematics,
	bakedFlowV2Doc,
	bakedGameConfig,
	editorArtSheetsWhere,
	preparedEditorDoc,
	refuseNoGameServer,
	refuseOnlineBoot,
	setRoomDocChange,
} from '../editor-scenes';
import { arcadePerf } from './arcadePerf';
import { typingInto } from './flowKeys';
import { zoneArtDrawsRig, zonePropOf, zoneSceneryOf, zoneStampsOf } from './zoneArt';
import { dispatchFlowV2Complete, getFlowV2 } from './flowV2InterpreterHolder';
import { restartFlow } from './roomFlow';
import { stateApp } from './stateApp';
import { stateModes } from './stateModes.svelte';

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
 * (`view`), so an ability is tested against what the player saw. On a world screen it also says how
 * much of the world the window shows about the own player ({@link follow}; `engine-mechanics`
 * `shown.js`): a room whose `nearby` has a `max` sends it the players in that view as well as the
 * box's.
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
 * In a Salmons room a character whose component names none plays the game's own
 * ({@link clipLookOf}). A class that names a character SHEET (`arcade.online.characters[].sheet`,
 * `docs/design/character-pipeline.md`) plays that instead ({@link sheetOf}): its actions, on any
 * room event that names the player, in its view's facings.
 *
 * A FIELD PER ROOM (P11.2 (e)): when the config names a generator (`arcade.online.generator`),
 * the join waits for the room's first state, makes the room's own field from the seed it carries
 * (the very function the server ran) and draws it in place of the authored one
 * ({@link withRoomField}, `FIELD_DRAWINGS`), as the scenes load. The state also carries the levels
 * the room's generator read, the prop colliders it laid in (a bridge's ramps) and a fingerprint of
 * the level it made, and the device makes its field through `engine-mechanics` `roomLevelGame`
 * alone: it plays the ROOM's levels and props, never its own
 * config's where the two differ (an authoring boot is told so, {@link showLevelsNotice}), and
 * leaves a room whose level it still cannot make ({@link otherLevel}). What it draws is what the
 * room collides against.
 *
 * ART IN CODE: a generator with built-in art ({@link FIELD_ART}: Salmons' original images) has it
 * loaded in the background after the join, from a lazy chunk no other game fetches. Once loaded,
 * the field is drawn in it and each player of a character it draws gets a code look, animated
 * here every frame from how it moves and the room's events; a published clip still wins over it
 * once its first frame is loaded. What the game draws for a player whatever draws the player is
 * not its look's: a line starts at its hand ({@link standOf}) in the art's style, and a text
 * rises over it ({@link drawFloats}).
 * Until then, or if it fails to load, the placeholders. The same art draws Salmons' screens
 * (the win animation, the death screen and its respawn, the lobby's note of who waits and its
 * classes to pick), told here what the room's events and state say and acting through
 * {@link screenHost}.
 *
 * WHO IT PLAYS, BEFORE THE JOIN: a game whose art has a start menu ({@link START_MENU}) shows it
 * to a launch that carries no character, and joins only with its answer (`engine-mechanics`
 * `launchJoin`). The room may be waiting or long running: the device is in none while its person
 * chooses, so it is never put in play as a class it did not pick. A launch that carries its
 * character joins at once. After the join a person changes class only in place, through the room:
 * a caught player picks its next on the death screen, and one waiting in a new room's lobby on the
 * lobby's note, while the room says it may ({@link RoomState.picking}). Either is asked with the
 * inputs' `respawn` and answered by the room's state (`engine-mechanics` `createRespawnAsk`).
 *
 * Launch parameters: `?rooms_url=` the game server (`wss://rooms.invisiblewall.org`), the game
 * key `?rooms_game=` (else `?project=`), and optionally `?rooms_name=` / `?rooms_character=`;
 * `?room_size=<n>` joins a TEST room of that many players instead of the game's public rooms
 * (the server's `ROOM_NAME_TEST`, which refuses a size outside the game's test range).
 *
 * ANOTHER ROOM ON THE SAME PAGE ({@link switchRoom}; Salmons' win screen's "Join New Game"): the
 * device leaves its room and joins a new one as its player is now, without loading the page again.
 * The picture of the old room stands until the new one is in hand (joined, its level made); then,
 * in one task, everything held or drawn for the old one goes ({@link closeSession}) and the
 * mounted game shows the new one ({@link showRoom}): every screen taken down, the flow back at
 * its start, the new field drawn by the room's art in the layout node's place. Whatever stops
 * that (a join that fails or never answers, a room that refuses the device, art that does not
 * load, anything thrown) loads the page again to join as that same player ({@link failSwitch}).
 * `engine-rooms` (`@colyseus/sdk`) is imported only here, on this path, so an offline game never
 * loads it.
 */

/**
 * Salmons' art, loaded only for its generators: each region from the project's own sheets when the
 * published editor art ships them (`game-config` `SALMONS_PROJECT_SHEETS`, by manifest key), else
 * from the built-in copy. A snapshot published before the project held them draws the built-in.
 */
const salmonsArt = async (
	made: SalmonsRiverDrawing,
	seed: number,
	stains?: StainLook,
	zoneArt?: SalmonsZoneArt,
) =>
	(await import('engine-layout/salmons-art')).loadSalmonsArt(
		made,
		seed,
		editorArtSheetsWhere((key) => salmonsProjectSheetOf(key) !== undefined),
		stains,
		zoneArt,
	);

/** The zone art a generator's own art draws the room's zones and its trees with
 *  (`game/zoneArt.ts`), and how to load the rig drawing (`engine-layout/zone-art-rig`, a lazy chunk
 *  no other game fetches) when it names a rig; none for a config with none, so the art draws as it
 *  does without. A rig drawing that does not load leaves the rigs' pieces built in. */
function roomZoneArt(zones: OnlineGame['zones'], seed: number): SalmonsZoneArt | undefined {
	const stamps = zoneStampsOf(zones, seed);
	const trees = zoneSceneryOf('@trees');
	if (!stamps.length && !trees) return undefined;
	const assets = () => stateApp.loadedAssets as Record<string, unknown> | undefined;
	const loadRig = () =>
		import('engine-layout/zone-art-rig').then(
			(art) => art.zoneRigDraw(assets),
			(error: unknown) => {
				console.warn(
					`[online] zone art's rigs are drawn built in: their drawing did not load (${error})`,
				);
				return undefined;
			},
		);
	return { stamps, trees, assets, ...(zoneArtDrawsRig() ? { loadRig } : {}) };
}

/** How see-through a game draws its rules' marks (`arcade.online.rules.stains`, read off the
 *  baked config: `game-config` `onlineCarry.ts`). */
type StainLook = { opacity: number; trailOpacity: number };

/** The built-in art a generator's field and characters are drawn with, loaded only for it. */
const FIELD_ART: Readonly<
	Record<
		string,
		(
			made: SalmonsRiverDrawing,
			seed: number,
			stains?: StainLook,
			zoneArt?: SalmonsZoneArt,
		) => Promise<SalmonsArt>
	>
> = {
	salmonsRiver: salmonsArt,
	salmonsMap: salmonsArt,
};

/** Salmons' start menu, from the same lazy chunk as its art. */
const salmonsStart = async (host: SalmonsStartHost) =>
	(await import('engine-layout/salmons-art')).chooseSalmonsStart(host);

/** The start menu a generator's built-in art has: who the device joins as is picked on it, before
 *  the join, by a launch that carries no character. */
const START_MENU: Readonly<Record<string, typeof salmonsStart>> = {
	salmonsRiver: salmonsStart,
	salmonsMap: salmonsStart,
};

/** The game server's room type (`services/game-server/src/server.ts` `ROOM_NAME`). */
const ROOM_NAME = 'arcade';
/** Its test rooms' type (`ROOM_NAME_TEST`): joined with a `size`. */
const ROOM_NAME_TEST = 'arcade-test';

/** Colyseus' close code for a leave the device asked for. */
const CONSENTED = 4000;

type PlayerState = {
	name?: string;
	character: string;
	x: number;
	y: number;
	connected: boolean;
	ack: number;
	status: number;
	score: number;
	mark: boolean;
	/** How high a rules module has lifted it, px (a salmon's leap); unset until the room writes it. */
	z?: number;
	/** Free but held still by a rules module (a salmon climbing); unset from an older server. */
	held?: boolean;
	/** Inputs left for which the room carries the move `carryX` / `carryY` (a salmon's leap). */
	air?: number;
	carryX?: number;
	carryY?: number;
	/** A fisherman's line, as the room syncs it (Salmons): out (`lineActive`) to its bobber at
	 *  `lineX` / `lineY`, world px. Unset from a room that syncs no line. */
	lineActive?: number | boolean;
	lineX?: number;
	lineY?: number;
	/** The player holding it in its hands while it is `held` (a `hook` ability's `carry`); unset
	 *  from an older server. */
	heldBy?: string;
};
type RoomState = {
	step: number;
	phase: string;
	round: number;
	endsAt: number;
	winner: string;
	/** The room's seed, from which a generated field is made (P11.2 (e)). */
	seed: number;
	/** The levels the room's generator read for that seed, as JSON, and a fingerprint of the level
	 *  it made (`engine-mechanics` `roomLevelState`); unset from an older server, or by a game with
	 *  no generator. */
	levels?: string;
	levelHash?: string;
	/** The prop colliders it laid into the level, as JSON (`roomLevelState`); unset when it has
	 *  none, or from an older server: the device then plays none. */
	props?: string;
	/** Whether the room lets its people change the class they play now (a lobby, until round 1
	 *  starts); unset from an older server, or by a game with no lobby. */
	picking?: boolean;
	players: Map<string, PlayerState>;
	/** What its rules module left on the field (Salmons' bloodstains); unset from an older server. */
	stains?: StainList;
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
	/** The largest body's longer side: how far past the window's edge a player standing there can
	 *  still show (a look stands on its feet), added to what the device says its screen shows. */
	reach: number;
	/** The fishing lines the room's events tell of. */
	lines: HookLines;
	/** The lines drawn, room ids (the probe's). */
	drawnLines: { by: string; target: string }[];
	/** Each holder whose line came into view, `<holder id>`, newest last (the probe's). */
	lineLog: string[];
	/** The marked players drawn gold over a glow (not those a code look draws), room ids (the
	 *  probe's). */
	glowed: string[];
	/** The own player's abilities, raised on the press; made with its first place. */
	abilities: AbilityPredictor | undefined;
	/** The flow signals raised, newest last (the probe's). */
	signals: OnlineFlowSignal[];
	/** Room player id → how its clips play (only for a character that has clips). */
	looks: Map<string, PlayerLook>;
	/** Character id → its clips, or `null` when it has none; read once its component is
	 *  registered. */
	clipLooks: Map<string, CharacterClips | null>;
	/** Class id → the sheet it names, or `null` when it plays none; read with its first player. */
	sheets: Map<string, CharacterSheet | null>;
	/** How a sheet's rig is drawn (`engine-layout/sheet-rig`), loaded for the first class whose
	 *  sheet names a rig; `null` while it loads. */
	rigArt: typeof import('engine-layout/sheet-rig') | null | undefined;
	/** Room player id → this frame's rig animation, for a player whose sheet is drawn as a rig. */
	rigFrames: Map<string, SheetRigFrame>;
	/** Room player id → its rigs by bundle name, while it is drawn: one a rig its sheet has drawn
	 *  it with, so a turn between two rigs builds neither again. */
	rigLooks: Map<string, Map<string, SheetRigLook>>;
	/** Room player id → the look its clip is drawn through at a lean, while it is drawn: for a
	 *  player whose sheet turns smoothly (`view.turn`), in place of a published clip. */
	turnLooks: Map<string, SheetClipLook>;
	/** Whether the last frame published a rig's mount or a turned clip's (so the frame after the
	 *  last one goes publishes none, in a room with no code look to do it). */
	rigMounted: boolean;
	/** Clip id → its box in art px, once its first frame is loaded. */
	clipBoxes: Map<string, { w: number; h: number }>;
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
	/** What the join did about the room's level (`engine-mechanics` `roomLevelGame`; the
	 *  probe's): `undefined` in a game with no generator. */
	level: RoomLevelReport | undefined;
	/** The generator's built-in art, once loaded ({@link FIELD_ART}). */
	art: SalmonsArt | undefined;
	/** Room player id → its code look, while it is drawn. */
	codeLooks: Map<string, CodeLook>;
	/** Holder id → when its line was cast (`hooked`), on the clip clock. */
	casts: Map<string, number>;
	/** Holder id → when its synced line went out (`lineActive`), on the clip clock. */
	lineCasts: Map<string, number>;
	/** The screens the art draws in code, once it is loaded. */
	screens: ReturnType<SalmonsArt['screens']> | undefined;
	/** What the own player asks the room to play as (a caught player's Respawn, a pick in the
	 *  lobby): sent as inputs' `respawn` until the room acknowledges one, and answered by the
	 *  state that does (`engine-mechanics` `createRespawnAsk`). */
	ask: RespawnAsk;
	/** The winner's pass the room gave this device (`winnerPass`), for its next join. */
	pass: string | undefined;
	/** The own player's character its predictor and abilities were made for. */
	character: string | undefined;
	/** Room player id → the character its looks were made for (a respawn may change it). */
	lookCharacters: Map<string, string>;
	/** The own player's last non-zero move, world units (a key-only cast is aimed along it). */
	facing: { x: number; y: number } | undefined;
	/** The buttons of the last input sent (a tap is a press). */
	buttons: number;
	/** Whether the person played the round now running or just ended: an input of its that moved,
	 *  pressed or asked for a respawn while it ran. Only then does the win screen join the next game
	 *  by itself (an idle tab does not hop rooms for ever). */
	played: boolean;
	/** Room player id → how far it is drawn raised (`lift`, screen px, eased): with the ground under
	 *  it (`ground`, the art's) and over it by the room's height (`aloft`, the art's: a fisherman on a
	 *  bridge); and where it was drawn. */
	lifts: Map<string, { lift: number; ground: number; aloft: number; x: number; y: number }>;
	/** The room's bridges drawn as prop components (the art's `bridges`), fed every state. */
	bridges: SalmonsBridges | undefined;
	/** The device left this room for another ({@link switchRoom}): its leave is no lost room. */
	quit: boolean;
	/** Stop hearing the room's states and events. */
	unlisten: () => void;
	/** Everything held or drawn for it is gone ({@link closeSession}). */
	closed: boolean;
	/** It took another room's place on a mounted game ({@link switchRoom}). */
	switched: boolean;
	/** The last room state's arrival and step, while the `?perf=1` probe reads ({@link noteLate}). */
	arrival: { atMs: number; step: number } | undefined;
};

/** What this page joins rooms of, read once at its boot: the config's own game, the server and the
 *  game's key, the launch's own name and character, a test room's size, an authoring boot. */
type Launch = {
	resolved: OnlineGame;
	url: string;
	game: string;
	own: { name: string | null; character: string | null };
	size: string | null;
	authoring: boolean;
};

let session: Session | undefined;

/** How the last room's field art stands, after the room too (the probe's: a leave destroys it). */
let fieldArt: SalmonsArt['rivers'] | undefined;

/** A player's clips: its animator, its drawn places of the last moment (its velocity) and, once
 *  the room put it out, how long its instance waits for its catch and whether the catch started.
 *  `shown` is this frame's clip and `box` that clip's box once its first frame is loaded: only
 *  then is the clip what is drawn. A class that names a sheet plays it (`sheet`), any other its
 *  `characterClips` block (`look`). A sheet drawn as a rig (`rig`) has no clip: its frames go to
 *  the session's `rigFrames`. */
type PlayerLook = (
	| { look: CharacterClips; animator: CharacterAnimator; sheet?: undefined; rig?: undefined }
	| { sheet: CharacterSheet; animator: SheetAnimator; look?: undefined; rig?: undefined }
	| { sheet: CharacterSheet; animator: SheetRigAnimator; look?: undefined; rig: true }
) & {
	trail: { x: number; y: number; atMs: number }[];
	leaving: { until: number; caught: boolean } | undefined;
	/** The clip of the last frame; its `lean` when the sheet turns smoothly (`view.turn`). */
	shown:
		| (CharacterClipFrame & {
				lean?: number;
				/** The clip it is turning from while such a sheet mixes two pictures. */
				blend?: { from: CharacterClipFrame & { lean?: number }; weight: number };
				/** Its cycle carried on from the clip before (a change of facing in the turn). */
				kept?: true;
		  })
		| undefined;
	box: { w: number; h: number } | undefined;
	/** Whether the clip is drawn at its lean by a look of its own ({@link Session.turnLooks}), not
	 *  published as a clip: a sheet that turns smoothly. */
	turned: boolean;
	/** A rig's animation as last drawn, `rig:<rig>/<animation>` and `~` when mirrored (the
	 *  probe's log). */
	rigShown?: string;
};

/** Start a player's clips afresh where it is next drawn: no one-shot, no velocity from its last
 *  place (it was hidden, or the room moved it). */
const restart = (look: PlayerLook) => {
	look.leaving = undefined;
	look.trail.length = 0;
	look.animator.reset();
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
	view: () => ScreenSize;
	/** The screen's projector (none for a flat screen) and, projected, its camera's zoom fields. */
	projector: IsoProjector | undefined;
	zoom: ReturnType<typeof sceneCameraZoom>;
	/** The view this frame, world px (the design box over the zoom), and the zoom. */
	size: Size | undefined;
	drawnZoom: number;
	/** What the window shows about the own player this frame, as the next input says it. */
	shown: Shown | undefined;
};
type Size = { w: number; h: number };
/** The design box, how many window px a design px is drawn (the layout's main box `scale`; a
 *  `window` zoom divides it out, and takes 1 without it), and the window the box is fitted in
 *  (the canvas, CSS px): the world is drawn over all of it, not only inside the box. */
type ScreenSize = Size & { scale?: number; canvas: Size };
let worldCamera: OnlineCamera | undefined;

/** An input of a device that says nothing of its screen (no world camera, or no place yet). */
const NOTHING_SHOWN: Shown = { shownW: 0, shownH: 0, shownIso: 0 };

/** A movement key's direction: the world's axes on a flat screen, the screen's on an isometric one
 *  (Up is straight up the screen, as the original's keys). */
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
/** The keys: `held` are down now; a button key pressed and lifted between two steps is still in
 *  the next step's input (`engine-mechanics` `createPressLatch`). */
const keyLatch = createPressLatch();
const held = keyLatch.held();

const onKey = (event: KeyboardEvent) => {
	if (!(event.code in MOVE_KEYS) && !(event.code in BUTTON_KEYS)) return;
	if (event.type === 'keydown' && typingInto(event.target)) return;
	// The arrows and Space would otherwise scroll a page the game sits in.
	event.preventDefault();
	if (event.type === 'keydown') keyLatch.press(event.code);
	else keyLatch.lift(event.code);
};
const releaseAll = () => keyLatch.clear();

/** How the held movement keys' directions become the input's move. */
type KeyMove = (dirs: readonly (readonly [number, number])[]) => { moveX: number; moveY: number };

/** Summed on the world's axes, each at full scale (a diagonal is both). */
const axisMove: KeyMove = (dirs) => {
	let x = 0;
	let y = 0;
	for (const [dx, dy] of dirs) {
		x += dx;
		y += dy;
	}
	return { moveX: Math.sign(x) * MOVE_SCALE, moveY: Math.sign(y) * MOVE_SCALE };
};

/**
 * On an isometric screen, as the original's keys (`client/input.js`): each held direction is the
 * screen's (Up straight up the screen, a key held twice counted once), turned into the world by the
 * screen's projector (`projection.ts` `screenToWorldDirection`: mirrored for Salmons), summed and
 * normalised to the move's full scale, so a diagonal is no faster.
 */
const screenMoveBy =
	(projector: IsoProjector): KeyMove =>
	(dirs) => {
		let x = 0;
		let y = 0;
		for (const [dx, dy] of dirs) {
			x += dx;
			y += dy;
		}
		const world = screenToWorldDirection(projector, Math.sign(x), Math.sign(y));
		return world.x === 0 && world.y === 0
			? { moveX: 0, moveY: 0 }
			: pointerMove({ x: 0, y: 0 }, world, 0);
	};

/** What the keys do: how they move, and the button Space presses. */
type Keys = { move: KeyMove; space: number };
const PLAIN_KEYS: Keys = { move: axisMove, space: BUTTONS.jump };

/** The input the held keys make, before the clamp. */
const keyInput = (seq: number, view: number, keys: Keys = PLAIN_KEYS) => {
	const dirs: (readonly [number, number])[] = [];
	let buttons = 0;
	for (const code of held) {
		const move = MOVE_KEYS[code];
		if (move) dirs.push(move);
	}
	for (const code of keyLatch.take())
		buttons |= code === 'Space' ? keys.space : (BUTTON_KEYS[code] ?? 0);
	return { seq, ...keys.move(dirs), buttons, aimX: 0, aimY: 0, view, respawn: 0 };
};

/**
 * The keys of the own character in a game with `arcade.online.keys: 'screen'` (Salmons, the
 * original's keys): screen-relative on an isometric world screen, and Space presses what a tap
 * presses (a bear's swipe), except a cast, which lands where it is aimed, so Space alone does
 * nothing for a fisherman. Any other game: as they were.
 */
function keysOf(current: Session): Keys {
	const { online } = current.game;
	if (online.keys !== 'screen') return PLAIN_KEYS;
	const projector = worldCamera?.projector;
	const move = projector ? screenMoveBy(projector) : axisMove;
	const me = stateOf(current.room).players?.get(current.room.sessionId);
	const tap =
		me && online.pointer && Object.hasOwn(online.pointer.taps, me.character)
			? online.pointer.taps[me.character]
			: 'jump';
	if (tap === 'jump') return { move, space: BUTTONS.jump };
	const ability = online.rules.abilities.find(
		(a) => a.character === me?.character && a.button === tap,
	);
	return { move, space: ability?.effect === 'hook' ? 0 : BUTTONS[tap] };
}

/**
 * Join a room of this game, or stop the boot on the error screen saying why: the config cannot be
 * played online, the launch names no server or game, or the server cannot be reached or refused
 * the join (full, unknown character).
 */
export async function joinOnlineRoom(): Promise<void> {
	const baked = bakedGameConfig();
	// The slide and the levels' shape are carried on the raw doc (`game-config` `onlineSlide.ts`,
	// `levelsShape.ts`), as the room reads them.
	const resolved = shapedOnlineGame(
		withOnlineSlide(onlineGameOf(normalizeGameConfigDoc(baked) ?? null), baked),
		baked,
	);
	if (!resolved) return refuseOnlineBoot('the config is not an online game');
	const params = new URLSearchParams(window.location.search);
	const url = params.get('rooms_url');
	const game = params.get('rooms_game') || params.get('project');
	const next = takeNextJoin(url, game);
	if ('refused' in resolved) return refuseOnlineBoot(resolved.refused);
	if (!url) return refuseNoGameServer();
	if (!game) return refuseOnlineBoot('the launch names no game (?rooms_game=)');
	const generator = resolved.online.generator;
	const startMenu = generator ? START_MENU[generator] : undefined;
	const own = { name: params.get('rooms_name'), character: params.get('rooms_character') };
	const asked = launchJoin(next, own, startMenu !== undefined);
	let join = asked.join;
	if (asked.choose && startMenu) {
		try {
			const picked = await startMenu({
				name: join.name,
				rivers: (signal) => listRivers(url, game, signal),
			});
			join = { ...join, ...picked };
		} catch (error) {
			return refuseOnlineBoot(
				`its start menu did not load (${error instanceof Error ? error.message : String(error)})`,
			);
		}
	}
	const refused = await enterRoom(
		{
			resolved,
			url,
			game,
			own,
			size: params.get('room_size'),
			authoring: params.get(AUTHORING_PARAM) === '1',
		},
		join,
	);
	if (refused !== undefined) return refuseOnlineBoot(refused);
}

/**
 * Join a room of the launch's game as `join` and make it the page's session. Returns why it could
 * not; nothing once it is in, or when that room went again meanwhile (its leave has said so).
 * `replaced` is the session it takes the place of on a page whose game is mounted
 * ({@link switchRoom}): its picture stands until this one is made, and the task that makes it
 * lets the old one go and shows the new room in its place ({@link showRoom}).
 */
async function enterRoom(
	launch: Launch,
	join: NextJoin,
	replaced?: Session,
): Promise<string | undefined> {
	const { resolved, url, game, size, authoring } = launch;
	const generator = resolved.online.generator;
	let room: Room | undefined;
	let predict: Predict | undefined;
	try {
		const { Client } = await import('engine-rooms');
		const sdk =
			resolved.online.netcode === 'colyseus' ? await import('engine-rooms/predict') : null;
		room = await new Client(url).joinOrCreate(size ? ROOM_NAME_TEST : ROOM_NAME, {
			game,
			...join,
			...(size ? { size: Number(size) } : {}),
		});
		predict = sdk?.Predict.get(room);
	} catch (error) {
		room?.leave().catch(() => {});
		return `the game server did not let it in (${error instanceof Error ? error.message : String(error)})`;
	}
	const switched = replaced !== undefined;
	// A switch that has already failed is loading the page again: what it joined late goes.
	if (switched && reloading) {
		room.leave(true).catch(() => {});
		return undefined;
	}
	// A room that is gone for good (disposed, a kick, a reconnect that ran out) leaves nothing to
	// play: say so on the same screen rather than freeze on the last state. Until its session is
	// made, a leave is the join's answer (its close code), and nothing of it is drawn yet: on a
	// switch the old room's picture stands.
	let left: number | undefined;
	let made: Session | undefined;
	room.onLeave((code: number) => {
		left = code;
		if (!made) return predict?.dispose();
		// A room the device left for another is closed where the other took its place.
		if (made.quit) return;
		if (session) dropArt(session);
		session = undefined;
		clearMarks();
		clearClips();
		predict?.dispose();
		if (code !== CONSENTED) void refuseOnlineBoot(`the room closed (code ${code})`, true);
	});
	const seed = generator ? await roomSeed(room) : undefined;
	if (left !== undefined) return `the room closed as it was joined (code ${left})`;
	if (generator && seed === undefined) {
		room.leave().catch(() => {});
		return 'the room did not say which field it plays';
	}
	// The room's levels, not this boot's config's: the state that carried the seed carries them.
	const level = seed === undefined ? undefined : roomLevelGame(resolved, seed, stateOf(room));
	if (level && 'refused' in level) {
		room.leave().catch(() => {});
		return otherLevel(level, authoring);
	}
	const played = level ?? { game: resolved, made: undefined };
	const draw = generator ? FIELD_DRAWINGS[generator] : undefined;
	const field = played.made && draw?.(played.made);
	const prepared = preparedEditorDoc();
	if (field && prepared && !holdsNode(prepared, field.id)) {
		room.leave().catch(() => {});
		return missingFieldNode(field.id);
	}
	const loadArt = generator ? FIELD_ART[generator] : undefined;
	// A mounted game draws another room's field only through that room's art ({@link showRoom}).
	if (replaced && field && !loadArt) {
		room.leave().catch(() => {});
		return 'this game has no art to draw another room’s field with: load it again';
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
		reach: Math.max(
			0,
			...played.game.online.characters.map((c) => {
				const { w, h } = sizeOf(played.game.bodies[c.body]);
				return Math.max(w, h);
			}),
		),
		lines: createHookLines(),
		drawnLines: [],
		lineLog: [],
		glowed: [],
		abilities: undefined,
		looks: new Map(),
		clipLooks: new Map(),
		sheets: new Map(),
		rigArt: undefined,
		rigFrames: new Map(),
		rigLooks: new Map(),
		turnLooks: new Map(),
		rigMounted: false,
		clipBoxes: new Map(),
		clipClock: 0,
		clipLog: [],
		signals: [],
		serverVariables: undefined,
		seed,
		field,
		fieldDrawn: undefined,
		level: level && {
			adopted: level.adopted,
			differs: level.differs,
			levelHash: level.levelHash,
			roomLevelHash: level.roomLevelHash,
		},
		art: undefined,
		codeLooks: new Map(),
		casts: new Map(),
		lineCasts: new Map(),
		screens: undefined,
		ask: createRespawnAsk(),
		pass: undefined,
		character: undefined,
		lookCharacters: new Map(),
		facing: undefined,
		buttons: 0,
		played: false,
		lifts: new Map(),
		bridges: undefined,
		quit: false,
		unlisten: () => {},
		closed: false,
		switched,
		arrival: undefined,
	};
	if (switched && reloading) {
		room.leave(true).catch(() => {});
		return undefined;
	}
	made = current;
	// A key pressed before the room (the menu, a join) is not the first step's press.
	keyLatch.clear();
	if (replaced) {
		closeSession(replaced);
		// Measured on the layout the page booted with, as a boot's load measures it
		// ({@link withRoomField}); a layout fetched at mount is not in hand here.
		if (field && prepared) current.fieldDrawn = holdsNode(prepared, field.id);
		dropNextJoin();
	}
	session = current;
	arcadePerf.info = {
		online: true,
		fixedHz: resolved.online.tickHz,
		patchHz: resolved.online.patchHz,
	};
	if (level?.adopted && authoring) showLevelsNotice(level.differs);
	const stains = onlineStainsOf(bakedGameConfig());
	if (loadArt && field && played.made && seed !== undefined)
		loadArt(played.made, seed, stains, roomZoneArt(played.game.zones, seed))
			.then((art) => {
				if (session !== current || left !== undefined) return art.destroy();
				current.art = art;
				fieldArt = art.rivers;
				// Before the river is drawn: it draws the water and behind pieces published here.
				current.bridges = art.bridges(
					current.game,
					current.game.online.layer,
					bakedCinematics(),
					zonePropOf(current.game.online.props, 'bridge#'),
				);
				setFieldArt(field.id, art.river);
				current.screens = art.screens(screenHost(current, launch));
				for (const [id, mount] of current.screens.mounts) setFieldArt(id, mount);
			})
			.catch((error: unknown) => {
				console.warn('[online] the field art did not load', error);
				// A room joined in another's place has only its art to draw its field with, and no
				// screen (lobby note, death screen, win button) without it: the person is not left
				// there.
				if (switched && session === current)
					failSwitch(launch, join, `the new room’s art did not load (${error})`);
			});
	// Before the game mounts and anything is spawned, so no look is remounted to be wrapped.
	startMarks();
	if (current.field) setRoomDocChange(withRoomField);
	const onState = () => received(current, performance.now());
	room.onStateChange(onState);
	meterMessages(room);
	const offEvents = room.onMessage(ONLINE_EVENT, (events: OnlineEvent[]) => {
		current.events.push(...events);
		current.events.splice(0, current.events.length - EVENTS_KEPT);
		current.lines.events(events);
		screenEvents(current, events);
		const players = stateOf(current.room).players;
		for (const signal of flowSignalsOf(
			events,
			current.room.sessionId,
			(id) => {
				const player = players?.get(id);
				return (
					player && {
						...(() => {
							const at = placeOf(current, id, player);
							return raisedPlace(at, liftOf(current, id, at));
						})(),
						character: player.character,
					}
				);
			},
			current.abilities,
		))
			raise(current, signal);
	});
	current.unlisten = () => {
		room.onStateChange.remove(onState);
		offEvents();
	};
	if (switched) await showRoom(current, launch, join);
	return undefined;
}

/** Draws nothing: the ground of a room whose art is still to come, in the layout node's place. */
const NO_GROUND: ArtMount = () => () => {};

/**
 * Show the room the page is in now on the mounted game, in place of the one it left
 * ({@link switchRoom}; that one is let go already, in this same task), with no frame between.
 *
 * THE FIELD. The game keeps the layout it mounted with, whose field node is the first room's. A
 * generated field is drawn by the room's art in that node's place, so the node is never drawn
 * again: nothing until this room's art is in ({@link NO_GROUND}), then its river. The world's size
 * is the session's ({@link useOnlineCamera}).
 *
 * THE CAMERA. The room's state is read at once, so the own player has its place and the first
 * frame is drawn from there, not from where the old room's camera stood.
 *
 * THE FLOW is not built again, and its doc is not changed: it is brought back to its start
 * (`game/roomFlow.ts` `restartFlow`), which shows the game and whatever the room's phase asks for
 * (Salmons' lobby) with no loading screen on the way. Its start-up chain may hold for a tap, so it
 * is not waited for; if it fails, the switch has ({@link failSwitch}).
 */
async function showRoom(current: Session, launch: Launch, join: NextJoin) {
	if (current.field) setFieldArt(current.field.id, NO_GROUND);
	received(current, performance.now());
	const flow = getFlowV2();
	if (!flow) return;
	const { chain } = await restartFlow(flow, bakedFlowV2Doc(), {
		unmount: flushSync,
		resetModes: stateModes.reset,
		roomValues: () => bindServerVariables(current, stateOf(current.room)),
		complete: dispatchFlowV2Complete,
	});
	chain.catch((error: unknown) => failSwitch(launch, join, `its flow did not start (${error})`));
}

/** How long a leave for a new room may take to be in it (the join's answers and the room's first
 *  state), ms: past it the switch has failed. */
const SWITCH_MS = 12000;

/**
 * Leave the room for a new one of the same game, as the player is now and with the winner's pass
 * the room gave it, on the same page. Nothing is heard, sent or moved for the old room from here
 * on, and its picture stands until the new one takes its place ({@link enterRoom}); the win
 * screen's button says it is joining meanwhile (`salmonsArt/winAnimation.ts`).
 *
 * The join is also written where a boot reads it ({@link takeNextJoin}) and taken back once the
 * device is in. Whatever stops the switch (a join the server refuses, one that has not put the
 * device in a room within {@link SWITCH_MS}, a level it cannot make, anything thrown on the way)
 * ends in {@link failSwitch}.
 */
async function switchRoom(current: Session, launch: Launch) {
	if (session !== current) return;
	let join: NextJoin = {};
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const me = stateOf(current.room).players?.get(current.room.sessionId);
		join = launchJoin(
			{
				...(me?.name ? { name: me.name } : {}),
				...(me ? { character: me.character } : {}),
				...(current.pass ? { pass: current.pass } : {}),
			},
			launch.own,
			false,
		).join;
		keepNextJoin(launch, join);
		current.quit = true;
		current.unlisten();
		session = undefined;
		current.room.leave(true).catch(() => {});
		const refused = await Promise.race([
			enterRoom(launch, join, current),
			new Promise<string>((resolve) => {
				timer = setTimeout(() => resolve('the new room did not answer in time'), SWITCH_MS);
			}),
		]);
		if (refused !== undefined) failSwitch(launch, join, refused);
	} catch (error) {
		failSwitch(launch, join, error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timer);
	}
}

/** Whether a failed switch is already loading the page again. */
let reloading = false;

/**
 * A leave for a new room did not get the person into one they can play: leave whatever room the
 * page is in and load the page again, to join as that same player (the join is kept for that boot,
 * {@link takeNextJoin}). It is what "Join New Game" did before it stayed on the page, and it works
 * in every kind of boot: the error screen and its Reload show only on a live-authoring boot
 * (`editor-scenes` `markRuntimeStale`), so elsewhere a failed switch would leave the win screen up
 * with nothing to press.
 */
function failSwitch(launch: Launch, join: NextJoin, reason: string) {
	if (reloading) return;
	reloading = true;
	console.error(`[online] could not change rooms (${reason}): loading the game again`);
	if (session) {
		session.quit = true;
		session.unlisten();
		session.room.leave(true).catch(() => {});
	}
	keepNextJoin(launch, join);
	window.location.reload();
}

/**
 * Let go of a room the device left for another (it stopped hearing it when it left), with
 * everything held or drawn for it: its prediction, each player's instance and looks, the lines,
 * marks, clips and stains, the art with its screens (the win animation stopped), the camera (the
 * next room's world may be another size), the fingers and keys held, and an author's note about
 * its levels.
 */
function closeSession(current: Session) {
	if (current.closed) return;
	current.closed = true;
	current.sdk?.me?.dispose();
	current.sdk?.predict.dispose();
	const live = spawnStore();
	for (const instance of current.drawn.values()) live.despawn(instance);
	current.drawn.clear();
	dropArt(current);
	current.bridges?.drop();
	current.bridges = undefined;
	clearMarks();
	clearClips();
	worldCamera = undefined;
	if (pointerIo) {
		pointerIo.tracker.release();
		pointerIo.touch?.control.release();
		pointerIo.touch = undefined;
		pointerIo.owner = undefined;
		syncTouchButton(pointerIo, undefined);
	}
	pendingTap = undefined;
	keyLatch.clear();
	document.getElementById(LEVELS_NOTICE_ID)?.remove();
}

/** The session-storage key a leave for a new room writes and a boot's join reads once. */
const NEXT_JOIN_KEY = 'ie:rooms:next-join';

type NextJoin = { name?: string; character?: string; pass?: string };

/** The longest name a next join carries (the start menu's field). */
const NEXT_NAME_LENGTH = 40;

/** Keep the join a leave for a new room makes, for the boot a failed one loads. */
function keepNextJoin({ url, game }: Launch, join: NextJoin) {
	try {
		sessionStorage.setItem(NEXT_JOIN_KEY, JSON.stringify({ server: url, game, ...join }));
	} catch {
		// No session storage: a boot after a failed join is the launch's own.
	}
}

/** The device is in its new room: no later boot is that join. */
function dropNextJoin() {
	try {
		sessionStorage.removeItem(NEXT_JOIN_KEY);
	} catch {
		// No session storage: nothing was kept.
	}
}

/**
 * The join a leave for a new room kept and did not get to make ({@link failSwitch}), taken: read
 * and cleared at every boot, and honoured only by a launch of the same game on the same server.
 */
function takeNextJoin(server: string | null, game: string | null): NextJoin {
	try {
		const raw = sessionStorage.getItem(NEXT_JOIN_KEY);
		sessionStorage.removeItem(NEXT_JOIN_KEY);
		const next: unknown = raw ? JSON.parse(raw) : undefined;
		if (!next || typeof next !== 'object') return {};
		const kept = next as Record<string, unknown>;
		if (!server || !game || kept.server !== server || kept.game !== game) return {};
		const { name, character, pass } = kept;
		return {
			...(typeof name === 'string' ? { name: name.slice(0, NEXT_NAME_LENGTH) } : {}),
			...(typeof character === 'string' ? { character } : {}),
			...(typeof pass === 'string' ? { pass } : {}),
		};
	} catch {
		return {};
	}
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

/**
 * Why a device leaves a room whose level it cannot make (`roomLevelGame`'s refusal): its picture
 * would not be the room's collisions. It made another level from the room's own levels (the
 * runtime's generator is not the game server's: the two are released apart, and either may be the
 * older), so a reload or a short wait is what helps; or it had none of the room's levels to read
 * (too long to send, or another generator's), and on an authoring boot the likely difference is
 * the editor's unpublished ones. The two fingerprints end the reason, for the log.
 */
const otherLevel = ({ refused, levelHash, roomLevelHash }: RoomLevelRefusal, authoring: boolean) =>
	(refused === 'levels' && authoring
		? 'the room plays other level settings than the ones saved in the editor, and could not ' +
			"send its own (too long, or another generator's): publish in Game Maker to play yours"
		: 'the room plays a level this game cannot make from its seed (the game and the game ' +
			'server are of different versions): reload, or try again in a few minutes') +
	` [level ${levelHash}, the room's ${roomLevelHash}]`;

const LEVELS_NOTICE_ID = 'ie-room-levels-notice';

/** `['overlays', 'river', 'waterfalls']` as "overlays, river and waterfalls". */
const listed = (parts: readonly string[]) =>
	parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];

/** What an author is told when the room's levels are not the editor's ({@link showLevelsNotice}). */
const levelsNotice = (differs: readonly string[]) =>
	`This room plays the level settings published when it opened, not the ones saved in the ` +
	`editor (different: ${listed(differs)}). Publish in Game Maker to play yours in new rooms.`;

/**
 * Tell an AUTHOR (an `ie_authoring=1` boot, every launcher link) that the game plays the room's
 * levels, not the ones the editor last saved: without it a Save levels that changed nothing on
 * screen reads as a broken editor. A player is told nothing: the level a player sees is simply
 * the room's. A small strip over the top of the game that stays until its ✕ is pressed; only the
 * ✕ takes a pointer, so a touch on the strip still reaches the play field under it.
 */
function showLevelsNotice(differs: readonly string[]) {
	if (document.getElementById(LEVELS_NOTICE_ID)) return;
	const notice = document.createElement('div');
	notice.id = LEVELS_NOTICE_ID;
	notice.setAttribute('role', 'status');
	notice.setAttribute(
		'style',
		'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483646;' +
			'display:flex;align-items:flex-start;gap:10px;box-sizing:border-box;' +
			'width:max-content;max-width:min(560px,calc(100vw - 20px));padding:8px 8px 8px 12px;' +
			'border-radius:8px;border-left:4px solid #f5b83d;background:#1c1b1ff2;color:#fff;' +
			'font:500 13px/1.4 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.45);' +
			'pointer-events:none',
	);
	const text = document.createElement('span');
	text.textContent = levelsNotice(differs);
	const close = document.createElement('button');
	close.type = 'button';
	close.textContent = '✕';
	close.title = 'Dismiss';
	close.setAttribute('aria-label', 'Dismiss');
	close.setAttribute(
		'style',
		'flex:none;border:0;border-radius:4px;padding:2px 6px;background:transparent;' +
			'color:#fff;opacity:.8;font:600 14px/1.4 system-ui,sans-serif;cursor:pointer;' +
			'pointer-events:auto',
	);
	close.onclick = () => notice.remove();
	notice.append(text, close);
	document.body.appendChild(notice);
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

/** Whether a class of this room plays a sheet ({@link sheetOf}). */
function playsSheets(current: Session): boolean {
	for (const sheet of current.sheets.values()) if (sheet) return true;
	return false;
}

/** Raise a room event in the flow (an online event), and start the one-shot clip it plays: a
 *  block's on the four events it knows, a sheet's on any event that names the player, as its user
 *  or as its target (`engine-layout` `sheetSignalsOf`). */
function raise(current: Session, signal: OnlineFlowSignal) {
	current.signals.push(signal);
	current.signals.splice(0, current.signals.length - EVENTS_KEPT);
	const event = clipSubject(signal);
	if (event) {
		const subject = event === 'caught' ? signal.payload.target : signal.payload.player;
		// Only a player drawn now: an event that comes after its instance went plays nothing later.
		if (typeof subject === 'string' && current.drawn.has(subject)) {
			const look = current.looks.get(subject);
			if (look?.look) look.animator.event(event);
		}
	}
	if (playsSheets(current))
		for (const { id, signal: about } of sheetSignalsOf(signal.name, signal.payload)) {
			const look = current.drawn.has(id) ? current.looks.get(id) : undefined;
			if (look?.sheet) look.animator.raise(about);
		}
	// A new round puts every player at its start: no velocity from where it was.
	if (signal.name === 'roundStart') for (const look of current.looks.values()) restart(look);
	if (current.art) lookEvent(current, signal);
	void getFlowV2()?.dispatch(signal.name, signal.payload);
}

/** A room event a code look plays (a hop, a climb, an ability), and when a line was cast. */
function lookEvent(current: Session, signal: OnlineFlowSignal) {
	const { player, by } = signal.payload;
	if (signal.name === 'hooked' && typeof by === 'string') current.casts.set(by, current.clipClock);
	if (
		(signal.name === 'caught' || signal.name === 'escaped' || signal.name === 'held') &&
		typeof by === 'string'
	)
		current.casts.delete(by);
	if (signal.name === 'roundStart') current.casts.clear();
	if (
		(signal.name === 'jumped' || signal.name === 'climbed' || signal.name === 'ability') &&
		typeof player === 'string'
	)
		current.codeLooks.get(player)?.event(signal.name, current.clipClock);
}

/** The room is gone: its art, every code look and every rig with it. */
function dropArt(current: Session) {
	clearArt();
	for (const look of current.codeLooks.values()) look.destroy();
	current.codeLooks.clear();
	for (const id of [...current.rigLooks.keys()]) dropRigLooks(current, id);
	for (const id of [...current.turnLooks.keys()]) dropTurnLook(current, id);
	current.rigFrames.clear();
	current.screens?.destroy();
	current.screens = undefined;
	current.art?.destroy();
	current.art = undefined;
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
		level: onlineLevel(
			game.zones,
			game.online.rules.zones,
			character.id,
			game.field,
			game.online.slide,
		),
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
	if (arcadePerf.on) noteLate(current, state.step, nowMs);
	current.view.observe(state.step, nowMs);
	bindServerVariables(current, state);
	current.others.retain(new Set(players.keys()));
	players.forEach((player, id) => {
		if (id !== current.room.sessionId) {
			current.others.push(id, state.step!, player.x, player.y);
			return;
		}
		// A respawn as another character: its own body, speed and abilities from now on.
		if (current.character !== player.character) {
			current.character = player.character;
			current.abilities = undefined;
			current.me = undefined;
			if (current.sdk) {
				current.sdk.me?.dispose();
				current.sdk.me = undefined;
			}
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
			still: player.status !== STATUS.free || player.held === true,
			step: state.step,
			air: player.air,
			carryX: player.carryX,
			carryY: player.carryY,
		});
	});
	current.bridges?.inputs(players.values(), state.step);
}

/**
 * How much later a room state came than the room's clock says it should have after the one before
 * (`arcadePerf.ts`): none for the first, nor for one at a step already heard. The room patches on
 * its own timer between its steps (20 patches to 30 steps in Salmons), so the gap it meant is the
 * whole number of patch periods nearest the time its steps advanced — not that time itself, which
 * would read ±half a step late on a perfect network.
 */
function noteLate(current: Session, step: number, nowMs: number) {
	const last = current.arrival;
	if (!last) {
		current.arrival = { atMs: nowMs, step };
		return;
	}
	if (step <= last.step) return;
	const { tickHz, patchHz } = current.game.online;
	const stepped = ((step - last.step) * 1000) / tickHz;
	const period = patchHz > 0 ? 1000 / patchHz : 0;
	const meant = period ? Math.max(1, Math.round(stepped / period)) * period : stepped;
	arcadePerf.late(nowMs - last.atMs - meant);
	last.atMs = nowMs;
	last.step = step;
}

/** The SDK's frame codes (`@colyseus/shared-types` `Protocol`): a full state, a patch, and the
 *  code's bits under the frame's modifiers (`PROTOCOL_CODE_MASK`). */
const ROOM_STATE = 14;
const ROOM_STATE_PATCH = 15;
const PROTOCOL_CODE_MASK = 31;

/**
 * Count the room's states and their bytes, time the handling of its every message, and tally every
 * message in and out (`arcadePerf.message`: the network block's room traffic), for the `?perf=1`
 * probe (`arcadePerf.ts`). It reads the SDK's transport (`room.connection.events`), which looks its
 * `onmessage` up afresh for each message and keeps the connection across a reconnect, so one wrap
 * after the join holds for the room; what the client sends goes through the connection's `send` and
 * `sendUnreliable`.
 */
function meterMessages(room: Room) {
	const { connection } = room;
	const { events } = connection;
	const handle = events.onmessage;
	if (!handle) return;
	events.onmessage = (event: { data: ArrayBuffer | Uint8Array }) => {
		if (!arcadePerf.on) {
			handle(event);
			return;
		}
		const { counts } = arcadePerf;
		const bytes = event.data instanceof Uint8Array ? event.data : new Uint8Array(event.data);
		const code = bytes[0] & PROTOCOL_CODE_MASK;
		const state = code === ROOM_STATE || code === ROOM_STATE_PATCH;
		if (state) {
			counts.patches += 1;
			counts.patchBytes += bytes.byteLength;
		}
		arcadePerf.message(false, bytes.byteLength, state);
		const started = performance.now();
		handle(event);
		counts.netMs += performance.now() - started;
	};
	const send = connection.send.bind(connection);
	const sendUnreliable = connection.sendUnreliable.bind(connection);
	connection.send = (data) => {
		if (arcadePerf.on) arcadePerf.message(true, data.byteLength);
		send(data);
	};
	connection.sendUnreliable = (data) => {
		if (arcadePerf.on) arcadePerf.message(true, data.byteLength);
		sendUnreliable(data);
	};
}

type Point = { x: number; y: number };

/** The mouse and touch control (`arcade.online.pointer`), while the play field is mounted: its
 *  tracker, in client px, and how a client point becomes the canvas's global one. */
let pointerIo:
	| {
			tracker: PointerTracker;
			toGlobal: (x: number, y: number) => Point;
			/** The touch scheme of each class that has one (`arcade.online.touch`). */
			schemes: Map<string, ResolvedTouchScheme>;
			/** The class {@link ownTouch} last answered for. */
			owner?: string;
			/** The own class's touch control, made when its class is first played. */
			touch?: { character: string; control: TouchControl };
			/** The on-screen ability button, while the own class's scheme has one. */
			button?: HTMLButtonElement;
			/** A finger has been used, or the device is a phone or a tablet. */
			fingers: boolean;
	  }
	| undefined;

/** A tap waiting for a step whose last input did not press its button already. */
let pendingTap: Point | undefined;

/** Follow the mouse and the fingers on the canvas; returns the detach. */
function listenPointer(
	canvas: HTMLElement,
	toGlobal: (x: number, y: number) => Point,
	options: { mouse: 'hover' | 'press'; tapPx: number },
	schemes: Map<string, ResolvedTouchScheme>,
): () => void {
	const tracker = createPointerTracker(options);
	const io: PointerIo = {
		tracker,
		toGlobal,
		schemes,
		fingers: mobileDevice({
			userAgent: navigator.userAgent,
			maxTouchPoints: navigator.maxTouchPoints,
			innerWidth: window.innerWidth,
		}),
	};
	pointerIo = io;
	// The browser would take a moving finger for its own pan and cancel the press
	// (`pointercancel`): the canvas of a game steered by touch keeps every touch.
	const touchAction = canvas.style.touchAction;
	canvas.style.touchAction = 'none';
	const forward = (type: 'down' | 'move' | 'up' | 'cancel') => (e: PointerEvent) => {
		// A mouse hovers only over the canvas; a press and a finger are followed off it.
		if (type === 'move' && e.pointerType === 'mouse' && e.target !== canvas && !e.buttons) return;
		// A press on a button a screen offers over the game in play (the lobby's classes) is the
		// screen's: it steers nothing, and its lift is no tap.
		if (type === 'down' && onScreenButton(toGlobal(e.clientX, e.clientY))) return;
		const control = e.pointerType === 'mouse' ? undefined : ownTouch(io)?.control;
		if (e.pointerType !== 'mouse') io.fingers = true;
		if (control) {
			// The newest device steers: a finger forgets the hovering mouse.
			if (type === 'down') tracker.release();
			control.event({ type, id: e.pointerId, x: e.clientX, y: e.clientY }, e.timeStamp);
			return;
		}
		if (type === 'down') io.touch?.control.release();
		tracker.event({
			type,
			id: e.pointerId,
			kind: e.pointerType,
			x: e.clientX,
			y: e.clientY,
			button: e.button,
		});
	};
	const down = forward('down');
	const move = forward('move');
	const up = forward('up');
	const cancel = forward('cancel');
	const release = () => {
		tracker.release();
		io.touch?.control.release();
	};
	canvas.addEventListener('pointerdown', down);
	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
	window.addEventListener('pointercancel', cancel);
	window.addEventListener('blur', release);
	return () => {
		canvas.removeEventListener('pointerdown', down);
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
		window.removeEventListener('pointercancel', cancel);
		window.removeEventListener('blur', release);
		canvas.style.touchAction = touchAction;
		io.button?.remove();
		pointerIo = undefined;
		pendingTap = undefined;
	};
}

type PointerIo = NonNullable<typeof pointerIo>;

/** Whether a point of the canvas is on a button the room's screens offer over the game in play. */
const onScreenButton = (at: Point) => session?.screens?.takes(at.x, at.y) === true;

/** The own class's touch control, or none for a class with no scheme. A respawn as another class
 *  starts that class's control afresh. */
function ownTouch(io: PointerIo) {
	const current = session;
	const character = current
		? stateOf(current.room).players?.get(current.room.sessionId)?.character
		: undefined;
	if (io.owner === character) return io.touch;
	io.owner = character;
	const scheme = character === undefined ? undefined : io.schemes.get(character);
	// A press that began under another class's control is not this one's: where a scheme comes
	// or goes, both readers forget their fingers.
	if (io.touch || scheme) {
		io.touch?.control.release();
		io.tracker.release();
	}
	io.touch = scheme && character ? { character, control: createTouchControl(scheme) } : undefined;
	return io.touch;
}

/**
 * The on-screen button of a scheme whose ability is pressed by `button`: in the page over the
 * canvas, so a press on it is never a touch on the play field. Shown once a finger has been used
 * (or on a phone or a tablet), while the own player plays.
 */
function syncTouchButton(io: PointerIo, label: string | undefined, control?: TouchControl) {
	if (!label || !control || !io.fingers) {
		io.button?.remove();
		io.button = undefined;
		return;
	}
	if (io.button) {
		if (io.button.textContent !== label) io.button.textContent = label;
		return;
	}
	const button = document.createElement('button');
	button.id = 'ie-touch-ability';
	button.type = 'button';
	button.textContent = label;
	button.style.cssText =
		'position:fixed;right:max(20px,env(safe-area-inset-right));' +
		'bottom:max(28px,env(safe-area-inset-bottom));width:84px;height:84px;border-radius:50%;' +
		'border:2px solid rgba(255,255,255,.75);background:rgba(20,24,40,.55);color:#fff;' +
		'font:600 15px system-ui,sans-serif;touch-action:none;user-select:none;' +
		'-webkit-user-select:none;-webkit-touch-callout:none;z-index:5';
	button.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		pointerIo?.touch?.control.button();
	});
	button.addEventListener('contextmenu', (e) => e.preventDefault());
	document.body.append(button);
	io.button = button;
}

/** A pressed button's name on its on-screen button. */
const TOUCH_BUTTON_LABELS: Record<string, string> = {
	jump: 'Jump',
	ability1: 'Act',
	ability2: 'Act 2',
};

/**
 * Start reading the keyboard, and, for a game with `arcade.online.pointer`, the mouse and the
 * fingers on `canvas`; returns the stop.
 */
export function listenOnline(
	canvas?: HTMLElement,
	toGlobal?: (x: number, y: number) => Point,
): () => void {
	window.addEventListener('keydown', onKey);
	window.addEventListener('keyup', onKey);
	window.addEventListener('blur', releaseAll);
	const raw = bakedGameConfig();
	const game = onlineGameOf(normalizeGameConfigDoc(raw) ?? null);
	const online = game && 'online' in game ? game.online : undefined;
	const pointer = online?.pointer;
	const schemes = new Map<string, ResolvedTouchScheme>();
	for (const { id } of online?.characters ?? []) {
		const scheme = touchSchemeOf(raw, id, pointer);
		if (scheme) schemes.set(id, scheme);
	}
	const unpoint =
		canvas && toGlobal && pointer ? listenPointer(canvas, toGlobal, pointer, schemes) : undefined;
	return () => {
		window.removeEventListener('keydown', onKey);
		window.removeEventListener('keyup', onKey);
		window.removeEventListener('blur', releaseAll);
		releaseAll();
		unpoint?.();
	};
}

/**
 * A client point on the field, through the camera and the projection of the players' layer. On
 * raised ground (Salmons' waterfalls) the point is taken on the own player's ground: a place there
 * is drawn back by its lift on both axes, so the layer's point is moved forward by it.
 */
const fieldPoint = (current: Session, at: Point | undefined): Point | undefined => {
	if (!at || !pointerIo) return undefined;
	const global = pointerIo.toGlobal(at.x, at.y);
	const point = spawnLayerPoint(current.game.online.layer, global.x, global.y);
	const lift = current.lifts.get(current.room.sessionId)?.ground ?? 0;
	return point && lift ? { x: point.x + lift, y: point.y + lift } : point;
};

/**
 * The input with the pointer's part (`docs/design/arcade-pointer-controller.md`): with no movement
 * key held, the move heads for the pointer; a tap presses the own character's tap button for one
 * step, aimed at the tapped point. A class with a touch scheme (`arcade-touch-controls.md`) has its
 * fingers read by the scheme instead: its heading, and its press of the same button. No pointer
 * control, the input as it was.
 */
function withPointer(current: Session, input: ReturnType<typeof keyInput>) {
	const pointer = current.game.online.pointer;
	if (!pointerIo || !pointer) return input;
	const keysMove = [...held].some((code) => code in MOVE_KEYS);
	const own = ownPlace(current);
	const state = stateOf(current.room);
	const me = state.players?.get(current.room.sessionId);
	const name =
		me && Object.hasOwn(pointer.taps, me.character) ? pointer.taps[me.character] : undefined;
	const bit = name ? BUTTONS[name] : 0;
	const touch = ownTouch(pointerIo);
	const scheme = touch && pointerIo.schemes.get(touch.character);
	const playing = !!me && state.phase === 'running' && me.status !== STATUS.out;
	const touched = touch?.control.step({
		self: own,
		toField: (at) => fieldPoint(current, at),
		now: (current.seq * 1000) / current.game.online.tickHz,
		playing,
		keys: keysMove,
		still: !me || me.status !== STATUS.free || me.held === true,
		pressed: !!(current.buttons & bit),
		onTarget: (at) => !!me && !!name && !!scheme && onTouchTarget(current, me, name, at, scheme),
	});
	syncTouchButton(
		pointerIo,
		playing && name && scheme?.ability === 'button' ? TOUCH_BUTTON_LABELS[name] : undefined,
		touch?.control,
	);
	if (!keysMove) {
		if (touched?.move) Object.assign(input, touched.move);
		else if (!touch?.control.held()) {
			const target = fieldPoint(current, pointerIo.tracker.target());
			Object.assign(input, pointerMove(own, target, pointer.deadZone));
		}
	}
	if (touched?.press && bit) {
		input.buttons |= bit;
		if (touched.press.aim) {
			input.aimX = touched.press.aim.x;
			input.aimY = touched.press.aim.y;
		}
	}
	pendingTap ??= pointerIo.tracker.takeTap();
	if (!pendingTap) return input;
	if (!name) {
		pendingTap = undefined;
		return input;
	}
	// A tap is a press: a step that already pressed the button waits a step for its release.
	if (current.buttons & bit) return input;
	const aim = fieldPoint(current, pendingTap);
	pendingTap = undefined;
	input.buttons |= bit;
	if (aim) {
		input.aimX = aim.x;
		input.aimY = aim.y;
	}
	return input;
}

/**
 * Whether a tap at field point `at` is on a target of the ability the own class's tap button
 * presses (a scheme's `ability: 'target'`): for an aimed `hook` (Salmons' cast, which lands where
 * it is aimed) the water; for any other ability, a player of its targets drawn within the
 * scheme's `targetRadius`. A button with no ability (a jump) has no target.
 */
function onTouchTarget(
	current: Session,
	me: PlayerState,
	button: string,
	at: Point,
	scheme: ResolvedTouchScheme,
) {
	const ability = current.game.online.rules.abilities.find(
		(a) => a.character === me.character && a.button === button,
	);
	if (!ability) return false;
	// With a catch in its hands the press throws it, and it may be thrown anywhere.
	if (ability.effect === 'hook' && carries(current)) return true;
	if (ability.effect === 'hook')
		return current.game.zones.some(
			(zone) =>
				zone.id.endsWith('Water') &&
				at.x >= zone.x &&
				at.x <= zone.x + zone.w &&
				at.y >= zone.y &&
				at.y <= zone.y + zone.h,
		);
	let hit = false;
	stateOf(current.room).players?.forEach((player, id) => {
		if (hit || id === current.room.sessionId || !ability.targets.includes(player.character)) return;
		if (!shownInRoom(player)) return;
		const place = placeOf(current, id, player);
		hit = Math.hypot(place.x - at.x, place.y - at.y) <= scheme.targetRadius;
	});
	return hit;
}

/** Whether the own player holds another in its hands (a `hook` ability's `carry`). */
function carries(current: Session) {
	const me = current.room.sessionId;
	let holds = false;
	stateOf(current.room).players?.forEach((player) => {
		if (player.status === STATUS.held && player.heldBy === me) holds = true;
	});
	return holds;
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

/** How fast a drawn player's lift follows the ground under it, per second: a waterfall's step
 *  (up to 216 px) is climbed onto over a few frames, not in one. */
const LIFT_FOLLOW = 10;
/** A move this far in one frame is a respawn or a correction: the lift is taken at once. */
const LIFT_SNAP_PX = 192;

/** `was` eased towards `target` over `dtMs`. */
const eased = (was: number, target: number, dtMs: number) => {
	const next = was + (target - was) * Math.min(1, (dtMs / 1000) * LIFT_FOLLOW);
	return Math.abs(target - next) < 0.01 ? target : next;
};

/**
 * Player `id`'s lift this frame, drawn at `at`, eased towards the ground's under it and the
 * height the room has put it at over it (`aloft`: its holder's for a held player, so a salmon in a
 * fisherman's hands on a bridge is up there with him).
 */
function easeLift(
	current: Session,
	id: string,
	at: { x: number; y: number },
	aloftTarget: number,
	dtMs: number,
) {
	const groundTarget = current.art?.ground(at.x, at.y) ?? 0;
	const was = current.lifts.get(id);
	const near = was && Math.hypot(at.x - was.x, at.y - was.y) <= LIFT_SNAP_PX;
	const ground = near ? eased(was.ground, groundTarget, dtMs) : groundTarget;
	const aloft = near ? eased(was.aloft, aloftTarget, dtMs) : aloftTarget;
	const lift = { lift: ground + aloft, ground, aloft, x: at.x, y: at.y };
	current.lifts.set(id, lift);
	return lift;
}

/** How high over the ground the room has put `player` drawn, screen px (the art's `aloft`): its
 *  holder's while it is held. */
function aloftOf(current: Session, players: Map<string, PlayerState>, player: PlayerState) {
	const { art } = current;
	if (!art) return 0;
	const by = holderOf(players, player)?.player ?? player;
	return art.aloft(by.character, by.z ?? 0);
}

/** Player `id`'s lift as last drawn, else the ground's under `at`. */
const liftOf = (current: Session, id: string, at: { x: number; y: number }) =>
	current.lifts.get(id)?.lift ?? current.art?.ground(at.x, at.y) ?? 0;

/**
 * Where a world place is drawn raised by `lift` (Salmons' waterfalls, once the art is loaded).
 * Drawn isometric, moving back by the lift on both axes is moving straight up the screen by it, so
 * the look, its glow and its line all follow.
 */
const raisedPlace = (at: { x: number; y: number }, lift: number) =>
	lift ? { x: at.x - lift, y: at.y - lift } : at;

/** The player whose hands `player` is in (its `heldBy`, while it is `held`), if the device has it. */
function holderOf(players: Map<string, PlayerState>, player: PlayerState) {
	if (player.status !== STATUS.held || !player.heldBy) return undefined;
	const holder = players.get(player.heldBy);
	return holder && shownInRoom(holder) ? { id: player.heldBy, player: holder } : undefined;
}

/** How far in front of its holder a held player stands, world px on both axes: drawn just over
 *  it in the players' depth order. */
const CARRIED_FRONT = 1;

/**
 * Where a held player is drawn: where its holder is (the own one predicted, another between the
 * room's states), so the two never part on screen whichever of them the device predicts.
 * `undefined` for a player nobody holds.
 */
function carriedPlace(current: Session, players: Map<string, PlayerState>, player: PlayerState) {
	const holder = holderOf(players, player);
	if (!holder) return undefined;
	const at = placeOf(current, holder.id, holder.player);
	return { x: at.x + CARRIED_FRONT, y: at.y + CARRIED_FRONT };
}

/** The hands a held player is in, from its holder's place (screen px): the holder's hand point
 *  (`standOf`), else three quarters up its body. */
function handsOf(current: Session, players: Map<string, PlayerState>, player: PlayerState) {
	const holder = holderOf(players, player);
	if (!holder) return undefined;
	return (
		standOf(current, holder.id).hand ?? { dx: 0, lift: bodyOf(current, holder.player).h * 0.75 }
	);
}

/** How far a held player's instance is raised into its holder's hands. A code look places itself
 *  there (`LookFrame.carried`); a clip, a sheet or the placeholder is raised whole, its middle at
 *  the hands. */
function handLift(current: Session, id: string, player: PlayerState) {
	if (current.codeLooks.has(id)) return 0;
	const players = stateOf(current.room).players;
	const hands = players && handsOf(current, players, player);
	if (!hands) return 0;
	return Math.max(0, hands.lift - (standOf(current, id).middle ?? bodyOf(current, player).h / 2));
}

/** Put every player of the room where it is drawn. */
function draw(current: Session, dtMs: number) {
	const live = spawnStore();
	const { layer } = current.game.online;
	const players = stateOf(current.room).players;
	if (!players) return;
	current.clipClock += dtMs;
	for (const id of current.looks.keys()) if (!players.has(id)) current.looks.delete(id);
	for (const id of current.lifts.keys()) if (!players.has(id)) current.lifts.delete(id);
	for (const id of current.lookCharacters.keys())
		if (!players.has(id)) current.lookCharacters.delete(id);
	// A player became another character (a respawn, a pick in the lobby): its instance is its old
	// character's component, so it goes, and the pass below spawns the new one's this frame; its
	// looks are made afresh with it.
	players.forEach((player, id) => {
		const was = current.lookCharacters.get(id);
		current.lookCharacters.set(id, player.character);
		if (was === undefined || was === player.character) return;
		const instance = current.drawn.get(id);
		if (instance) {
			live.despawn(instance);
			current.drawn.delete(id);
		}
		if (arcadePerf.on && instance) arcadePerf.counts.despawns += 1;
		current.looks.delete(id);
		current.codeLooks.get(id)?.destroy();
		current.codeLooks.delete(id);
		dropRigLooks(current, id);
		dropTurnLook(current, id);
		current.lifts.delete(id);
	});
	for (const [id, instance] of current.drawn) {
		const player = players.get(id);
		if (player && (shownInRoom(player) || keptForCatch(current, id, player))) continue;
		live.despawn(instance);
		current.drawn.delete(id);
		if (arcadePerf.on) arcadePerf.counts.despawns += 1;
		const look = current.looks.get(id);
		if (look) restart(look);
	}
	const moves: { id: string; x: number; y: number }[] = [];
	const depths = new Map<string, number>();
	const places = new Map<string, { x: number; y: number }>();
	players.forEach((player, id) => {
		if (!shownInRoom(player)) return;
		const at = carriedPlace(current, players, player) ?? placeOf(current, id, player);
		places.set(id, at);
		const { lift, aloft } = easeLift(current, id, at, aloftOf(current, players, player), dtMs);
		const shown = raisedPlace(at, lift + handLift(current, id, player));
		const instance = current.drawn.get(id);
		// Raised onto a bridge's deck: sorted over it, as the original's player on a bridge.
		if (instance && aloft > 0 && current.art) depths.set(instance, current.art.aloftDepth(aloft));
		if (instance) {
			moves.push({ id: instance, x: shown.x, y: shown.y });
			// Held for its catch and shown again (it respawned): its clips start afresh.
			const look = current.looks.get(id);
			if (look?.leaving) restart(look);
			return;
		}
		const character = current.game.online.characters.find((c) => c.id === player.character);
		if (!character) return;
		const spawned = live.spawn(layer, character.body, shown);
		if (spawned.ok) {
			current.drawn.set(id, spawned.instance.id);
			if (arcadePerf.on) arcadePerf.counts.spawns += 1;
		} else if (!current.refused.has(character.body)) {
			current.refused.add(character.body);
			console.warn(
				`[online] cannot draw "${character.body}" in the layer "${layer}" (${spawned.reason})`,
			);
		}
	});
	live.move(moves);
	setDepths(depths);
	const lines = current.lines.drawn(players);
	drawMarks(current, players, lines);
	drawClips(current, players, places, lines);
	drawCodeLooks(current, players, places);
	drawFloats(current, players, places);
}

/** The rig a drawn player's sheet draws this frame, made with its first frame; `undefined` until
 *  the rig and its drawing are loaded. A frame of another rig takes another look. */
function rigLookOf(current: Session, id: string): SheetRigLook | undefined {
	const frame = current.rigFrames.get(id);
	const sheet = current.looks.get(id)?.sheet;
	if (!frame || !sheet || !current.rigArt) return undefined;
	let looks = current.rigLooks.get(id);
	let look = looks?.get(frame.rig);
	if (!look) {
		const data = rigDataOf(frame.rig);
		if (!data) return undefined;
		look = current.rigArt.createSheetRigLook(frame.rig, data, sheet);
		if (!looks) current.rigLooks.set(id, (looks = new Map()));
		looks.set(frame.rig, look);
	}
	look.frame(frame, current.clipClock);
	if (arcadePerf.on) arcadePerf.counts.looks += 1;
	return look;
}

/** The rig a player is drawn with this frame, if it is. */
const rigShownOf = (current: Session, id: string): SheetRigLook | undefined => {
	const frame = current.rigFrames.get(id);
	return frame && current.rigLooks.get(id)?.get(frame.rig);
};

/** A player's rigs are gone with it. */
function dropRigLooks(current: Session, id: string) {
	for (const look of current.rigLooks.get(id)?.values() ?? []) look.destroy();
	current.rigLooks.delete(id);
}

/** A player's turned clip is gone with it. */
function dropTurnLook(current: Session, id: string) {
	current.turnLooks.get(id)?.destroy();
	current.turnLooks.delete(id);
}

/**
 * Each drawn player's mount this frame (`arcadeArt.svelte.ts`): its sheet's rig, or its clip
 * turned by its sheet (`view.turn`), else its code look (once the art is loaded), made with its
 * first draw. A room with none of them publishes none. Whichever it is, the art may draw it half
 * under the water the player stands in (Salmons' bear wades: `salmonsArt/wade.ts`).
 */
function drawCodeLooks(
	current: Session,
	players: Map<string, PlayerState>,
	places: Map<string, { x: number; y: number }>,
) {
	const { art } = current;
	if (
		!art &&
		!current.rigFrames.size &&
		!current.rigLooks.size &&
		!current.turnLooks.size &&
		!current.rigMounted
	)
		return;
	art?.stains(stateOf(current.room).stains, current.clipClock);
	for (const [id, look] of current.codeLooks)
		if (!current.drawn.has(id)) {
			look.destroy();
			current.codeLooks.delete(id);
		}
	for (const id of [...current.rigLooks.keys()])
		if (!current.drawn.has(id)) dropRigLooks(current, id);
	for (const id of [...current.turnLooks.keys()])
		if (!current.drawn.has(id)) dropTurnLook(current, id);
	art?.wadersDrawn((id) => current.drawn.has(id));
	/** `mount` as the art's water draws it: `drawnW` is how wide a sheet draws the player (none:
	 *  its body's width, a code look's). */
	const waded = (id: string, player: PlayerState, mount: ArtMount, drawnW?: number): ArtMount => {
		if (!art) return mount;
		const at = places.get(id) ?? placeOf(current, id, player);
		const body = bodyOf(current, player);
		return art.wade(id, mount, {
			character: player.character,
			x: at.x,
			y: at.y,
			atMs: current.clipClock,
			middle: standOf(current, id).middle ?? body.h / 2,
			width: drawnW || body.w,
		});
	};
	let rigs = false;
	const mounts = new Map<string, ArtMount>();
	for (const [id, instance] of current.drawn) {
		const player = players.get(id);
		if (!player) continue;
		let look = current.codeLooks.get(id);
		const rig = rigLookOf(current, id);
		// A published clip wins over the code look once it is drawn; while its first frame loads,
		// the code look is (`<SpawnLayer>` draws the clip, else this, else the placeholder). A
		// sheet's rig takes the code look's place, and so does the clip of a sheet that turns
		// smoothly, which is drawn here and not published as a clip.
		const clip = current.looks.get(id);
		if (rig || clip?.box) {
			look?.destroy();
			current.codeLooks.delete(id);
			const mount = rig?.mount ?? (clip?.turned ? current.turnLooks.get(id)?.mount : undefined);
			if (mount) {
				mounts.set(instance, waded(id, player, mount, clip?.sheet && sheetDraw(clip.sheet).width));
				rigs = true;
			}
			continue;
		}
		if (!art) continue;
		if (!look) {
			look = art.look(player.character, bodyOf(current, player));
			if (!look) continue;
			current.codeLooks.set(id, look);
		}
		const at = places.get(id) ?? placeOf(current, id, player);
		look.frame({
			atMs: current.clipClock,
			x: at.x,
			y: at.y,
			status: player.status,
			marked: player.mark,
			z: player.z ?? 0,
			held: player.held === true,
			carried: handsOf(current, players, player),
			project: worldCamera?.projector?.project,
		});
		if (arcadePerf.on) arcadePerf.counts.looks += 1;
		mounts.set(instance, waded(id, player, look.mount));
	}
	current.rigMounted = rigs;
	setCodeLooks(mounts);
}

/** A loaded rig, as far as a sheet's animator asks it (`engine-rig` `SkeletonData`). */
type LoadedRig = Parameters<typeof import('engine-layout/sheet-rig').createSheetRigLook>[1];

/** The rig a published game loaded under its bundle name (`bakedEditorArtAssets`), if it did. */
function rigDataOf(rig: string): LoadedRig | undefined {
	const data = (stateApp.loadedAssets as Record<string, unknown> | undefined)?.[rig];
	return typeof (data as LoadedRig | undefined)?.findAnimation === 'function'
		? (data as LoadedRig)
		: undefined;
}

/** The loaded rigs, as a sheet's animator reads them. */
const RIG_SOURCE = {
	has: (rig: string, animation: string) => !!rigDataOf(rig)?.findAnimation(animation),
	durationMs: (rig: string, animation: string) => {
		const found = rigDataOf(rig)?.findAnimation(animation);
		return found ? found.duration * 1000 : undefined;
	},
	hasSkin: (rig: string, skin: string) => !!rigDataOf(rig)?.findSkin(skin),
};

/** The registered clips, as a character's animator reads them. */
const CLIP_SOURCE = {
	has: (clipId: string) => resolveFlipbook(clipId) !== undefined,
	cycleMs: (clipId: string) => flipbookCycleMs(clipId, false),
};

/**
 * The clips a Salmons room's characters play, by character id, whatever its components say of
 * them (`engine-layout` `SALMONS_CHARACTER_CLIPS`); none in any other room. A Salmons room is one
 * of the generators the launcher ships those clips for (`game-config` `SALMONS_ART_GENERATORS`).
 */
function gameClipsOf(current: Session, character: string): CharacterClips | undefined {
	const { generator } = current.game.online;
	const clips: Readonly<Record<string, CharacterClips>> = SALMONS_CHARACTER_CLIPS;
	return generator !== undefined &&
		SALMONS_ART_GENERATORS.includes(generator) &&
		Object.hasOwn(clips, character)
		? clips[character]
		: undefined;
}

/**
 * A character's clips: its component's, read once it is registered (the game registers its
 * components as it mounts, after the join). In a Salmons room a component that names none plays
 * the game's own ({@link gameClipsOf}), so the project needs only its clips published, and a
 * block that names no `facings` takes the game's (`engine-layout` `characterClipsIn`).
 */
function clipLookOf(
	current: Session,
	character: { id: string; body: string },
): CharacterClips | undefined {
	const known = current.clipLooks.get(character.id);
	if (known !== undefined) return known ?? undefined;
	const def = getComponent(character.body);
	if (!def) return undefined;
	const look = characterClipsIn(def.characterClips, gameClipsOf(current, character.id));
	current.clipLooks.set(character.id, look ?? null);
	return look;
}

/** A clip's box (`engine-layout` `clipBox`), kept once its first frame is loaded. */
function clipBoxOf(current: Session, clipId: string) {
	const known = current.clipBoxes.get(clipId);
	if (known) return known;
	const clip = resolveFlipbook(clipId);
	const box = clip && clipBox(clip, stateApp.loadedAssets as Record<string, unknown> | undefined);
	if (box) current.clipBoxes.set(clipId, box);
	return box;
}

/**
 * How a drawn player stands on its place, as it is drawn: where its hand is (a line it holds
 * starts there) and how high its middle is. A clip's are read off its box (`characterClips.hand`,
 * mirrored with the clip and turned by its lean), a code look's are its own; a placeholder has
 * neither.
 */
function standOf(
	current: Session,
	id: string,
): { hand?: { dx: number; lift: number }; middle?: number } {
	const clip = current.looks.get(id);
	if (clip?.shown && clip.box) {
		const upright = clip.sheet
			? sheetClipPoints(clip.sheet, clip.box, clip.shown.flipX)
			: clipPoints(clip.look, clip.box, clip.shown.flipX);
		const { lean } = clip.shown;
		if (!lean) return upright;
		// A clip drawn at a lean (`view.turn`): the hand turns with the body about the sheet's
		// pivot, and the middle is how high the turned middle is.
		const about = clip.sheet ? sheetLeanPivot(clip.sheet, clip.box) : 0;
		return {
			hand: leanedPoint(upright.hand, lean, about),
			middle: leanedPoint({ dx: 0, lift: upright.middle }, lean, about).lift,
		};
	}
	const rig = rigShownOf(current, id);
	if (rig) return rig.points();
	const look = current.codeLooks.get(id);
	return look ? { hand: look.hand, middle: look.middle } : {};
}

/**
 * The sheet a class plays (`docs/design/character-pipeline.md` §9): the `arcade.characters` entry
 * its `sheet` names, read off the config as baked (the normalizer drops a sheet, `game-config`
 * `characterSheet.ts`). `undefined` when it names none, or one that is missing, uses another
 * component or is not one this build plays: such a class plays as it always did. A sheet's still
 * images are registered as clips of one frame, so the clip channel draws them; the first sheet
 * drawn as a rig loads the rig's drawing (a lazy chunk no other game fetches).
 */
function sheetOf(current: Session, classId: string): CharacterSheet | undefined {
	const known = current.sheets.get(classId);
	if (known !== undefined) return known ?? undefined;
	const sheet = onlineClassSheetOf(bakedGameConfig(), classId)?.sheet;
	const played = sheetPlaysClips(sheet) || sheetPlaysRig(sheet) ? sheet : undefined;
	current.sheets.set(classId, played ?? null);
	if (sheetPlaysClips(played)) registerFlipbooks(sheetStillClips(played));
	else if (played && current.rigArt === undefined) {
		current.rigArt = null;
		import('engine-layout/sheet-rig').then(
			(art) => {
				if (session === current) current.rigArt = art;
			},
			(error: unknown) =>
				console.warn(`[online] a sheet's rig cannot be drawn: its drawing did not load (${error})`),
		);
	}
	return played;
}

/**
 * A player's clips, made with its first draw; `undefined` for a character with none. Its class's
 * sheet first ({@link sheetOf}), then its component's block or the game's ({@link clipLookOf}).
 */
function lookOf(current: Session, id: string, player: PlayerState): PlayerLook | undefined {
	const known = current.looks.get(id);
	if (known) return known;
	const character = current.game.online.characters.find((c) => c.id === player.character);
	const sheet = character && sheetOf(current, character.id);
	const look = sheet ? undefined : character && clipLookOf(current, character);
	const played = sheet
		? sheetPlaysRig(sheet)
			? { sheet, rig: true as const, animator: createSheetRigAnimator(sheet, RIG_SOURCE) }
			: { sheet, animator: createSheetAnimator(sheet, CLIP_SOURCE) }
		: look && { look, animator: createCharacterAnimator(look, CLIP_SOURCE) };
	if (!played) return undefined;
	const made: PlayerLook = {
		...played,
		trail: [],
		leaving: undefined,
		shown: undefined,
		box: undefined,
		turned: !!sheet && !sheetPlaysRig(sheet) && sheetTurns(sheet),
	};
	current.looks.set(id, made);
	return made;
}

/** The room's name for each status a player can have (`engine-mechanics` `STATUS`). */
const STATUS_NAME = new Map<number, string>(
	Object.entries(STATUS).map(([name, status]) => [status, name]),
);

/** The statuses that hold for a player, as its sheet's `status` triggers and variants name them:
 *  `holding` while its line holds a player, `carrying` while one is in its hands, `marked` while
 *  the room marks it, and its room status (`free`, `stunned`, `out`, `grounded`, `hooked`, `held`,
 *  `thrown`). */
function statusesOf(player: PlayerState, holding: boolean, carrying: boolean): string[] {
	const statuses: string[] = [];
	if (holding) statuses.push('holding');
	if (carrying) statuses.push('carrying');
	if (player.mark) statuses.push('marked');
	const status = STATUS_NAME.get(player.status);
	if (status) statuses.push(status);
	return statuses;
}

/** A rules event that put a player out, as its sheet hears it. */
const CAUGHT: SheetSignal = { event: 'caught', as: 'target' };

/**
 * Whether a player the room put out is still drawn: while its catch plays, and while its sheet
 * holds an action (`play: 'hold'`: its catch, or one its status starts) on its last frame, until
 * the room brings it back, it leaves or a round starts (each starts its clips afresh). The room's
 * `caught` comes just after the state that put it out, so it is waited for a moment; a character
 * with no `caught` clip and no hold is hidden at once, as before.
 */
function keptForCatch(current: Session, id: string, player: PlayerState): boolean {
	const look = current.looks.get(id);
	if (!look) return false;
	if (look.sheet && look.animator.held(current.clipClock, statusesOf(player, false, false))) {
		(look.leaving ??= { until: current.clipClock, caught: true }).caught = true;
		return true;
	}
	const plays = look.sheet
		? look.animator.plays(CAUGHT, statusesOf(player, false, false))
		: look.animator.plays('caught', player.mark);
	if (!plays) return false;
	const now = current.clipClock;
	look.leaving ??= { until: now + CAUGHT_WAIT_MS, caught: false };
	const caught = look.sheet ? look.animator.actionOf(CAUGHT) : look.look.on?.caught;
	// Once the catch started, it is kept exactly while it plays.
	if (look.animator.oneShot(now) === caught) {
		look.leaving.caught = true;
		return true;
	}
	return !look.leaving.caught && now < look.leaving.until;
}

/** Each drawn character's clip this frame, from how it moved as drawn since the last one. */
function drawClips(
	current: Session,
	players: Map<string, PlayerState>,
	places: Map<string, { x: number; y: number }>,
	lines: readonly HookLine[],
) {
	const holders = new Set(lines.map((line) => line.by));
	const carriers = new Set<string>();
	players.forEach((player) => {
		if (player.status === STATUS.held && player.heldBy) carriers.add(player.heldBy);
	});
	const clips = new Map<string, InstanceClip>();
	const now = current.clipClock;
	current.rigFrames.clear();
	for (const [id, instance] of current.drawn) {
		const player = players.get(id);
		const look = player && lookOf(current, id, player);
		if (!player || !look) continue;
		if (arcadePerf.on) arcadePerf.counts.looks += 1;
		const { trail } = look;
		const at = places.get(id) ?? trail.at(-1) ?? placeOf(current, id, player);
		trail.push({ x: at.x, y: at.y, atMs: now });
		while (trail.length > 2 && now - trail[1].atMs >= VELOCITY_WINDOW_MS) trail.shift();
		const from = trail[0];
		const dt = now - from.atMs;
		const vx = dt > 0 ? ((at.x - from.x) * 1000) / dt : 0;
		const vy = dt > 0 ? ((at.y - from.y) * 1000) / dt : 0;
		const project = worldCamera?.projector?.project;
		if (look.rig) {
			const frame = look.animator.frame({
				atMs: now,
				vx,
				vy,
				statuses: statusesOf(player, holders.has(id), carriers.has(id)),
				project,
			});
			if (frame) current.rigFrames.set(id, frame);
			const drawn = frame ? `rig:${frame.rig}/${frame.animation}${frame.flipX ? '~' : ''}` : '';
			if (drawn !== look.rigShown) {
				current.clipLog.push(`${id}:${drawn}`);
				current.clipLog.splice(0, current.clipLog.length - EVENTS_KEPT);
			}
			look.rigShown = drawn;
			continue;
		}
		const frame: PlayerLook['shown'] = look.sheet
			? look.animator.frame({
					atMs: now,
					vx,
					vy,
					statuses: statusesOf(player, holders.has(id), carriers.has(id)),
					project,
				})
			: look.animator.frame({
					atMs: now,
					vx,
					vy,
					holding: holders.has(id),
					marked: player.mark,
					project,
				});
		if (frame?.clipId !== look.shown?.clipId) {
			current.clipLog.push(`${id}:${frame?.clipId ?? ''}`);
			current.clipLog.splice(0, current.clipLog.length - EVENTS_KEPT);
		}
		look.shown = frame;
		look.box = frame && clipBoxOf(current, frame.clipId);
		if (!frame || !look.box) current.turnLooks.get(id)?.hide();
		if (!frame) continue;
		const clip: InstanceClip = {
			clipId: frame.clipId,
			flipX: frame.flipX,
			loop: frame.loop,
			play: frame.play,
			...(look.sheet
				? sheetDraw(look.sheet)
				: { width: look.look.displayWidth, anchorY: look.look.anchorY ?? 1 }),
			own: frame.marked,
		};
		if (!look.turned) {
			clips.set(instance, clip);
			continue;
		}
		// A sheet that turns smoothly: the same clip, drawn at its lean by a look of its own
		// ({@link drawCodeLooks} mounts it) once its first frame is loaded, and not published. It
		// is gold exactly when a published clip would be: the room marks the player, the layer
		// draws its mark ({@link drawMarks}: no code look) and the clip is not its own.
		if (!look.box) continue;
		let turn = current.turnLooks.get(id);
		if (!turn) {
			turn = createSheetClipLook({
				assets: () => stateApp.loadedAssets as Record<string, unknown> | undefined,
				loaded: () => stateApp.loaded,
			});
			current.turnLooks.set(id, turn);
		}
		const about = look.sheet ? sheetLeanPivot(look.sheet, look.box) : 0;
		const left = frame.blend;
		turn.frame(clip, {
			lean: frame.lean ?? 0,
			about,
			kept: frame.kept === true,
			marked: player.mark && !current.codeLooks.has(id),
			...(left
				? {
						blend: {
							clip: {
								...clip,
								clipId: left.from.clipId,
								flipX: left.from.flipX,
								loop: left.from.loop,
								play: left.from.play,
								own: left.from.marked,
							},
							turn: { lean: left.from.lean ?? 0, about },
							weight: left.weight,
						},
					}
				: {}),
		});
		if (arcadePerf.on) arcadePerf.counts.looks += 1;
	}
	if (current.looks.size || clipsOn()) setClips(clips);
}

/** The texts rising over players (Salmons' "you catch NAME!"), each over its player where and
 *  however it is drawn this frame. */
function drawFloats(
	current: Session,
	players: Map<string, PlayerState>,
	places: Map<string, { x: number; y: number }>,
) {
	current.art?.floats(current.clipClock, (id) => {
		const player = players.get(id);
		if (!player || !current.drawn.has(id)) return undefined;
		const at = places.get(id) ?? placeOf(current, id, player);
		return {
			...raisedPlace(at, liftOf(current, id, at)),
			middle: standOf(current, id).middle ?? bodyOf(current, player).h / 2,
		};
	});
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
 * The marked players drawn gold over a glow (a code look draws its own gold), and the fishing
 * lines, as drawn: a line the room syncs on its
 * holder (`lineActive`, `lineX`, `lineY`; Salmons' aimed cast) from the rod hand to the bobber,
 * raised with the ground under it (to the salmon on it, once one is), from the cast until it is
 * home; any other
 * holder's (a `hook` ability's) from holder to hooked while one is on it. Before the art is loaded
 * a line's ends are raised by the bodies' `h`, which in an isometric world is their depth on the
 * ground: right while the placeholders are sized to their bodies.
 */
function drawMarks(
	current: Session,
	players: Map<string, PlayerState>,
	lines: readonly HookLine[],
) {
	const marks = new Map<string, InstanceMark>();
	current.glowed = [];
	for (const [id, instance] of current.drawn) {
		const player = players.get(id);
		// A code look draws its own gold (Salmons' golden salmon is its golden texture, as the
		// original's): no glow under it, which a swimming salmon, drawn below the players' layer,
		// would have under it on top. (A player has one only while it is what is drawn.)
		if (!player?.mark || current.codeLooks.has(id)) continue;
		marks.set(instance, { width: bodyOf(current, player).w });
		current.glowed.push(id);
	}
	setMarks(marks);
	const links: InstanceLink[] = [];
	const was = new Set(current.drawnLines.map((line) => line.by));
	current.drawnLines = [];
	for (const line of lines) {
		const from = current.drawn.get(line.by);
		const to = current.drawn.get(line.target);
		const by = players.get(line.by);
		const target = players.get(line.target);
		if (!from || !to || !by || !target || by.lineActive) continue;
		current.drawnLines.push(line);
		const { hand } = standOf(current, line.by);
		links.push({
			from,
			to,
			fromLift: hand?.lift ?? bodyOf(current, by).h * 0.75,
			toLift: current.codeLooks.get(line.target)?.middle ?? bodyOf(current, target).h / 2,
			...lineStyle(current, hand, current.casts.get(line.by)),
		});
	}
	for (const id of current.lineCasts.keys())
		if (!players.get(id)?.lineActive) current.lineCasts.delete(id);
	for (const [id, from] of current.drawn) {
		const by = players.get(id);
		if (!by?.lineActive || by.lineX === undefined || by.lineY === undefined) continue;
		if (!current.lineCasts.has(id)) current.lineCasts.set(id, current.clipClock);
		const bobber = { x: by.lineX, y: by.lineY };
		const target = lines.find((l) => l.by === id)?.target ?? '';
		current.drawnLines.push({ by: id, target });
		// A salmon on the line is dragged with the bobber: the line ends at it as drawn (between the
		// room's states, as everyone else), so the two never part on screen.
		const on = current.drawn.get(target);
		const hooked = players.get(target);
		const { hand } = standOf(current, id);
		links.push({
			from,
			...(on && hooked
				? {
						to: on,
						toLift: current.codeLooks.get(target)?.middle ?? bodyOf(current, hooked).h / 2,
					}
				: {
						to: raisedPlace(bobber, current.art?.ground(bobber.x, bobber.y) ?? 0),
						toLift: 0,
					}),
			fromLift: hand?.lift ?? bodyOf(current, by).h * 0.75,
			...lineStyle(current, hand, current.lineCasts.get(id)),
		});
	}
	for (const line of current.drawnLines)
		if (!was.has(line.by)) {
			current.lineLog.push(line.by);
			current.lineLog.splice(0, current.lineLog.length - EVENTS_KEPT);
		}
	setLinks(current.game.online.layer, links);
}

/** A line's own look once the art is loaded: the cast's wiggle since `castAt`, from its holder's
 *  `hand` ({@link standOf}: a clip's or a code look's). */
function lineStyle(current: Session, hand: { dx: number } | undefined, castAt: number | undefined) {
	return current.art && hand
		? {
				style: current.art.line(
					current.clipClock - (castAt ?? -Infinity),
					current.clipClock,
					hand.dx,
				),
			}
		: {};
}

/** How far ahead of a fisherman a key-only cast lands, px (four of Salmons' cells). */
const KEY_CAST_PX = 192;
/** How far inside the water's edge a key-only cast is pulled, px. */
const KEY_CAST_INSET = 24;

/**
 * A key-only press of an aimed ability (a `hook`: Salmons' cast, which the room lands where it is
 * aimed, or as far towards it as its rules let the line reach). After a move: {@link KEY_CAST_PX}
 * ahead along the own player's last move, pulled into the nearest of the field's water zones
 * (`…Water`). Before any: at the nearest of its targets the device is sent, free or grounded, else
 * the nearest water. A tap's own aim is kept as it is.
 */
function aimKeyCast(current: Session, input: ReturnType<typeof keyInput>) {
	if (input.aimX || input.aimY) return;
	const players = stateOf(current.room).players;
	const me = players?.get(current.room.sessionId);
	const own = ownPlace(current);
	if (!players || !me || !own) return;
	const ability = current.game.online.rules.abilities.find(
		(a) => a.character === me.character && a.effect === 'hook' && input.buttons & BUTTONS[a.button],
	);
	if (!ability) return;
	const aim = current.facing ? aheadInWater(current, own, current.facing) : undefined;
	const at =
		aim ?? nearestTarget(current, players, own, ability.targets) ?? waterNear(current, own);
	if (!at) return;
	input.aimX = at.x;
	input.aimY = at.y;
}

/** {@link KEY_CAST_PX} along `facing` from `own`, pulled into the nearest water. */
function aheadInWater(current: Session, own: Point, facing: Point) {
	const length = Math.hypot(facing.x, facing.y);
	if (!(length > 0)) return undefined;
	return waterNear(current, {
		x: own.x + (facing.x / length) * KEY_CAST_PX,
		y: own.y + (facing.y / length) * KEY_CAST_PX,
	});
}

/** The nearest other connected player of `targets`, free or grounded, where it is drawn. */
function nearestTarget(
	current: Session,
	players: Map<string, PlayerState>,
	own: Point,
	targets: readonly string[],
) {
	let best: { at: Point; d: number } | undefined;
	players.forEach((player, id) => {
		if (id === current.room.sessionId || !player.connected) return;
		if (player.status !== STATUS.free && player.status !== STATUS.grounded) return;
		if (!targets.includes(player.character)) return;
		const at = placeOf(current, id, player);
		const d = Math.hypot(at.x - own.x, at.y - own.y);
		if (!best || d < best.d) best = { at, d };
	});
	return best?.at;
}

/** The point of the field's water zones (`…Water`) nearest `at`, {@link KEY_CAST_INSET} inside. */
function waterNear(current: Session, at: Point): Point | undefined {
	let best: { x: number; y: number; d: number } | undefined;
	for (const zone of current.game.zones) {
		if (!zone.id.endsWith('Water')) continue;
		const inset = Math.min(KEY_CAST_INSET, zone.w / 2, zone.h / 2);
		const x = Math.max(zone.x + inset, Math.min(zone.x + zone.w - inset, at.x));
		const y = Math.max(zone.y + inset, Math.min(zone.y + zone.h - inset, at.y));
		const d = Math.hypot(x - at.x, y - at.y);
		if (!best || d < best.d) best = { x, y, d };
	}
	return best && { x: best.x, y: best.y };
}

/** A player's name when nothing names it (the original's). */
const DEFAULT_NAME = 'Unknown Salmon';

/** The name of a player of the room an event is about: the event's own (`carried`), else the
 *  state's, else {@link DEFAULT_NAME}. */
const nameIn = (current: Session, id: string, carried?: string) =>
	carried || stateOf(current.room).players?.get(id)?.name || DEFAULT_NAME;

/**
 * What the room's events show on Salmons' screens and looks: the own player caught (the death
 * screen, "by" its catcher), the own player's catch (its "you catch NAME!" over it), the game won
 * (the win animation, which joins the next game by itself when the person played the round:
 * {@link Session.played}) and the winner's pass (kept for the next join). A refused Respawn, or pick,
 * is not read off its event: the state says it ({@link drawScreens}).
 */
function screenEvents(current: Session, events: readonly OnlineEvent[]) {
	const me = current.room.sessionId;
	for (const event of events) {
		if (event.type === 'caught') {
			if (event.target === me)
				current.screens?.caught({
					by: nameIn(current, event.by, event.byName),
					character: stateOf(current.room).players?.get(me)?.character ?? '',
				});
			if (event.by === me)
				current.art?.float(me, `you catch ${nameIn(current, event.target)}!`, current.clipClock);
		} else if (event.type === 'held') {
			// The held one is told who has it; the holder, what his next tap does.
			if (event.target === me)
				current.art?.float(me, `${nameIn(current, event.by)} has you!`, current.clipClock);
			if (event.by === me) current.art?.float(me, 'tap to throw it!', current.clipClock);
		} else if (event.type === 'gameWon') {
			current.screens?.caught(undefined);
			current.screens?.won({
				winner: event.winnerName || DEFAULT_NAME,
				won: event.winner === me,
				count: current.played,
			});
		} else if (event.type === 'roundStart') current.played = false;
		else if (event.type === 'winnerPass') current.pass = event.pass;
	}
}

/**
 * What the room's state shows on Salmons' screens each frame: the death screen only while the own
 * player is out, and the lobby's note (the room, who the device plays in it) and its clock (the
 * seconds to round 1, the flow's `secondsLeft`; none from a server older than the whole clock,
 * which runs none before the countdown) while the room waits for its players. While the room lets its people pick (`picking`: a lobby, until round 1 starts;
 * a server older than the pick never says so, and the note has no classes there) the note offers
 * the classes.
 *
 * What the person asked (a Respawn, a class of the note) reads its answer off this state, the one
 * that acknowledges an input that carried it: a caught player still out was refused (it plays
 * nothing: the death screen says so), as was a waiting one the room has as another class than it
 * picked (the note says so). The room takes a Respawn only in a running round of a game whose
 * respawn is manual, so only then is one answered; a player that is back, and a room that lets
 * nobody pick, drop what was asked.
 */
function drawScreens(current: Session) {
	const state = stateOf(current.room);
	const me = state.players?.get(current.room.sessionId);
	const out = me?.status === STATUS.out;
	const waiting = state.phase === 'waiting';
	const picking = !!me && waiting && state.picking === true;
	const { ask, screens } = current;
	const refused = ask.refused;
	if (me && out) {
		if (state.phase === 'running' && current.game.online.rules.respawn === 'manual')
			ask.answer(me.ack, 0);
	} else if (picking) ask.answer(me.ack, respawnOf(current, me.character));
	else ask.drop();
	if (!screens) return;
	if (out && ask.refused && !refused) screens.refused();
	if (!out) screens.caught(undefined);
	screens.lobby(
		me && waiting
			? {
					roomId: current.room.roomId,
					name: me.name ?? '',
					character: me.character,
					picking,
					refused: picking && ask.refused,
				}
			: undefined,
	);
	screens.clock(
		waiting
			? serverValuesOf(state, current.room.sessionId, current.game.online.tickHz).secondsLeft
			: undefined,
	);
}

/** A character as an input's `respawn` counts it: 1 + its index in the config's online
 *  characters, 0 for one the game does not have. */
const respawnOf = (current: Session, character: string) =>
	current.game.online.characters.findIndex((c) => c.id === character) + 1;

/**
 * What Salmons' screens' buttons do: Respawn, and a class of the lobby's note, ask the room for
 * a character with the inputs' `respawn` (1 + its index in the config's
 * `arcade.online.characters`) until the room answers (`createRespawnAsk`), and the player stays
 * in its room; the win animation's button leaves for a new room on the same page
 * ({@link switchRoom}).
 */
function screenHost(current: Session, launch: Launch): SalmonsScreenHost {
	const ask = (character: string) => {
		const respawn = respawnOf(current, character);
		if (respawn) current.ask.press(respawn);
	};
	return {
		respawn: ask,
		pick: ask,
		rejoin: () => void switchRoom(current, launch),
		rivers: (signal) => listRivers(launch.url, launch.game, signal),
	};
}

/**
 * The game's rooms, from the game server's listing: `GET <server>/rooms?game=<key>` (the server's
 * `rooms_url` over http), answering `[{ roomId, players }]`. `undefined` when it lists none.
 */
async function listRivers(
	server: string,
	game: string,
	signal: AbortSignal,
): ReturnType<SalmonsScreenHost['rivers']> {
	const at = new URL('rooms', server.endsWith('/') ? server : `${server}/`);
	at.protocol = at.protocol === 'wss:' ? 'https:' : at.protocol === 'ws:' ? 'http:' : at.protocol;
	at.searchParams.set('game', game);
	const answer = await fetch(at, { signal });
	if (!answer.ok) return undefined;
	const rooms: unknown = await answer.json();
	if (!Array.isArray(rooms)) return undefined;
	return rooms.flatMap((room: unknown) => {
		const { roomId, players } = (room ?? {}) as { roomId?: unknown; players?: unknown };
		return typeof roomId === 'string' && typeof players === 'number' ? [{ roomId, players }] : [];
	});
}

/**
 * Give an online game the camera of the layout's world screen, if it has one (as the offline loop's
 * `useWorldCamera`); the first world screen seen is kept for the page. `view` reads the current
 * design size, so a rotated device moves the view with it.
 */
export function useOnlineCamera(scenes: readonly Scene[], view: () => ScreenSize) {
	if (worldCamera) return;
	const scene = worldCameraScene(scenes);
	if (!scene) {
		// No world screen: nothing is drawn projected or zoomed (a page's earlier state is dropped).
		setWorldProjector(undefined);
		setWorldZoom(1);
		return;
	}
	const camera = createCamera(sceneCamera(scene), createRng('online:camera'));
	camera.snapNext = true;
	const projector = sceneProjector(scene);
	setWorldProjector(projector);
	const zoom = projector ? sceneCameraZoom(scene) : undefined;
	setWorldZoom(1);
	// A room that took another's place on this page plays its own field's world, whichever room
	// the layout was loaded for; the page's first room, the layout's, as loaded for it.
	const world = sceneWorld(scene);
	const field = session?.switched && session.field ? session.game.field : undefined;
	worldCamera = {
		camera,
		world: world && field ? { w: field.w, h: field.h } : world,
		view,
		projector,
		zoom,
		size: undefined,
		drawnZoom: 1,
		shown: undefined,
	};
}

/**
 * Move the camera after a frame, towards the own player as drawn. On raised ground, and in a leap
 * (its code look's drawn lift), the whole drawing is moved down by the own player's drawn lift,
 * which keeps the camera's world place, and its hold inside the world, as it was. A projected
 * screen's zoom (`SceneCamera.zoom`) makes the view the design box over it.
 *
 * WHAT THE WINDOW SHOWS, for the next input: the window over the same zoom (the world is drawn
 * over the whole canvas, past the design box), a body's reach on every side, and twice how far the
 * window's centre is from the own player's place. The room centres its region on that place; the
 * window is centred where the camera is drawn, which trails a moving player (`smoothing`), may be
 * held off it (a dead zone, the world's edge) and is moved by the drawing's shift. The shift is
 * counted from the ground's own lift under the player, the lift everyone on its terrace is drawn
 * with, so a leap and a lift still easing count and a terrace's height does not.
 */
function follow(current: Session, dtMs: number) {
	const at = worldCamera && ownPlace(current);
	if (!worldCamera || !at) return;
	const { camera, world, view } = worldCamera;
	const screen = view();
	// A screen whose camera names no zoom draws at 1 (no device test, every frame).
	const zoom = worldCamera.zoom
		? cameraZoom(worldCamera.zoom, {
				mobile: mobileDevice({
					userAgent: navigator.userAgent,
					maxTouchPoints: navigator.maxTouchPoints,
					innerWidth: window.innerWidth,
				}),
				windowScale: screen.scale,
			})
		: 1;
	const size = zoomedView({ w: screen.w, h: screen.h }, zoom);
	worldCamera.size = size;
	worldCamera.drawnZoom = zoom;
	setWorldZoom(zoom);
	const fromX = camera.x;
	const fromY = camera.y;
	stepCamera(camera, dtMs / 1000, { view: size, world, target: { ...at, vx: 0, vy: 0 } });
	if (arcadePerf.on) arcadePerf.counts.cameraPx += Math.hypot(camera.x - fromX, camera.y - fromY);
	const me = current.room.sessionId;
	const leap = current.codeLooks.get(me)?.drawn().lift ?? 0;
	setWorldCameraView({
		x: camera.x,
		y: camera.y,
		shakeX: camera.offsetX,
		shakeY: camera.offsetY + (current.lifts.get(me)?.lift ?? 0) + leap,
		view: size,
	});
	// From the view as it was just published: the numbers the stage draws by.
	const drawn = worldCameraView();
	const dx = at.x - (drawn.x + drawn.w / 2);
	const dy = at.y - (drawn.y + drawn.h / 2);
	const from = worldCamera.projector?.project(dx, dy) ?? { x: dx, y: dy };
	worldCamera.shown = shownOf({
		window: screen.canvas,
		windowScale: screen.scale,
		zoom,
		iso: worldCamera.projector !== undefined,
		margin: current.reach,
		off: {
			x: from.x + drawn.shakeX,
			y: from.y + drawn.shakeY - (current.art?.ground(at.x, at.y) ?? 0),
		},
	});
}

/** Raise the own player's abilities the input uses, on the press: drawn before the room answers. */
function predictAbilities(current: Session, buttons: number, seq: number) {
	const state = stateOf(current.room);
	const me = state.players?.get(current.room.sessionId);
	if (!current.abilities || !me) return;
	const free = state.phase === 'running' && me.status === STATUS.free;
	const own = ownPlace(current);
	const at = own && raisedPlace(own, liftOf(current, current.room.sessionId, own));
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
	if (!current) {
		if (pointerIo?.button) syncTouchButton(pointerIo, undefined);
		return;
	}
	const now = performance.now();
	current.viewStep = current.view.advance(now) ?? current.viewStep;
	// The SDK's order: reconcile and decay, then send (its reconciler steps each send), then read.
	current.sdk?.predict.tick(now);
	const ran = current.clock.advance(dtMs, () => {
		current.seq += 1;
		const raw = withPointer(
			current,
			keyInput(current.seq, Math.max(0, Math.floor(current.viewStep)), keysOf(current)),
		);
		raw.respawn = current.ask.input(current.seq);
		aimKeyCast(current, raw);
		// Every input says it, zeros included, so a resize or a lost camera reaches the room at once.
		Object.assign(raw, worldCamera?.shown ?? NOTHING_SHOWN);
		const input = clampInput(raw, current.game.field);
		if (input.moveX || input.moveY) current.facing = { x: input.moveX, y: input.moveY };
		if (
			(input.moveX || input.moveY || input.buttons || input.respawn) &&
			stateOf(current.room).phase === 'running'
		)
			current.played = true;
		const handle = current.room.input();
		Object.assign(handle.data, input);
		handle.send();
		if (input.buttons & BUTTONS.jump && !(current.buttons & BUTTONS.jump))
			current.codeLooks.get(current.room.sessionId)?.event('tap', current.clipClock);
		current.buttons = input.buttons;
		current.me?.input(input);
		predictAbilities(current, input.buttons, input.seq);
	});
	current.me?.frame(dtMs);
	if (arcadePerf.on) {
		arcadePerf.counts.simSteps += ran;
		arcadePerf.counts.simMs += performance.now() - now;
		arcadePerf.phase = stateOf(current.room).phase === 'running' ? 'play' : 'menu';
	}
	draw(current, dtMs);
	drawScreens(current);
	follow(current, dtMs);
	if (arcadePerf.on) arcadePerf.counts.bodies = current.drawn.size;
}

/** The room as the determinism probe reads it: the server's step and places, and how each player is
 *  drawn. */
export function onlineProbe() {
	const current = session;
	const state = current ? stateOf(current.room) : undefined;
	const bodies: { id: string; x: number; y: number; vx: number; vy: number; tags: string[] }[] = [];
	const drawn: {
		id: string;
		x: number;
		y: number;
		ground?: number;
		aloft?: number;
		depth?: number;
		status?: number;
		heldBy?: string;
	}[] = [];
	const hidden: string[] = [];
	const everyone = state?.players;
	everyone?.forEach((p, id) => {
		bodies.push({ id, x: p.x, y: p.y, vx: 0, vy: 0, tags: [] });
		if (!shownInRoom(p)) hidden.push(id);
		else if (current) {
			const at = carriedPlace(current, everyone, p) ?? placeOf(current, id, p);
			const ground = current.art ? liftOf(current, id, at) : 0;
			const aloft = current.lifts.get(id)?.aloft ?? 0;
			const instance = current.drawn.get(id);
			const depth = instance ? depthOf(instance) : 0;
			drawn.push({
				id,
				...at,
				...(ground ? { ground } : {}),
				...(aloft ? { aloft } : {}),
				...(depth ? { depth } : {}),
				...(p.status ? { status: p.status } : {}),
				...(p.heldBy ? { heldBy: p.heldBy } : {}),
			});
		}
	});
	const camera = worldCamera?.camera;
	return {
		steps: state?.step || 0,
		bodies,
		...(fieldArt ? { fieldArt: fieldArt() } : {}),
		...(camera && worldCamera
			? {
					camera: {
						x: camera.x,
						y: camera.y,
						shakeX: camera.offsetX,
						shakeY: camera.offsetY,
						lift: current?.lifts.get(current.room.sessionId)?.lift ?? 0,
						view: worldCamera.size ?? worldCamera.view(),
						zoom: worldCamera.drawnZoom,
						scale: worldCamera.view().scale,
						shown: worldCamera.shown ?? null,
						leap: current?.codeLooks.get(current.room.sessionId)?.drawn().lift ?? 0,
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
						level: current.level ?? null,
						bridges: current.bridges?.probe() ?? null,
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
						lineLog: [...current.lineLog],
						glowed: [...current.glowed],
						stains: Array.from({ length: state.stains?.length ?? 0 }, (_, i) => {
							const stain = state.stains?.at(i);
							return stain ? [stain.x, stain.y] : [];
						}),
						clips: Object.fromEntries(
							[...current.looks].flatMap(([id, { shown, box }]) =>
								shown && box && current.drawn.has(id)
									? [
											[
												id,
												{
													clipId: shown.clipId,
													flipX: shown.flipX,
													...(shown.lean === undefined ? {} : { lean: shown.lean }),
												},
											],
										]
									: [],
							),
						),
						...(current.turnLooks.size
							? {
									turned: Object.fromEntries(
										[...current.turnLooks].flatMap(([id, look]) =>
											current.drawn.has(id) && current.looks.get(id)?.box
												? [[id, look.drawn()]]
												: [],
										),
									),
								}
							: {}),
						clipLog: [...current.clipLog],
						rigs: Object.fromEntries(
							[...current.rigLooks.keys()].flatMap((id) => {
								const look = current.drawn.has(id) ? rigShownOf(current, id) : undefined;
								const played = current.looks.get(id);
								return look
									? [
											[
												id,
												{
													...look.drawn(),
													action: current.rigFrames.get(id)?.action,
													facing: played?.sheet ? played.animator.facing : undefined,
												},
											],
										]
									: [];
							}),
						),
						screens: current.screens?.drawn() ?? null,
						ask: current.ask.held(),
						buttons: current.buttons,
						played: current.played,
						art: current.art
							? {
									regions: current.art.regions(),
									looks: Object.fromEntries(
										[...current.codeLooks].map(([id, look]) => [
											id,
											{ ...look.drawn(), hand: look.hand ?? null, middle: look.middle },
										]),
									),
									lines: current.drawnLines.map((line) => {
										const { hand } = standOf(current, line.by);
										return hand && current.art?.line(Infinity, 0, hand.dx).color;
									}),
									hands: Object.fromEntries(
										current.drawnLines.map((line) => [
											line.by,
											standOf(current, line.by).hand ?? null,
										]),
									),
									floats: current.art.floating(),
									blood: current.art.blood(),
									wading: current.art.wading(),
								}
							: null,
						signals: current.signals.map((s) => ({ ...s })),
						spawned: spawnStore()
							.live(current.game.online.layer)
							.map((instance) => instance.componentId),
					},
				}
			: {}),
	};
}
