/**
 * Arcade characters in the game (`docs/design/game-families.md` §4.3, §7.2, P10.11):
 *   pnpm --filter launcher-api check:arcade-characters
 *
 * The mechanics (`behaviours.js`, steer, `stepSolid`, paths) are gated by the root
 * `check:arcade-characters`; this plays the loop, Flow and the sample made of them.
 *
 *  1. PARITY: a config with no characters runs the P10.8 loop — the starter game reaches the same
 *     bodies and signals whether or not the game hands the loop the characters' input, paths,
 *     variables, look inputs and spawner, none of which is ever read; its bodies carry no state.
 *  2. THE STAGE ORDER: controllers and brains set a character's velocity before the step moves it;
 *     every other body steps as P10.8 (and passes through solids); positions are written, then the
 *     looks' inputs, then the signals, after the frame.
 *  3. CONTROLLERS follow the input map: held actions (8-way, diagonals no faster), sideScroll,
 *     pointer, a held touch steering a keyboard controller, the movement settings.
 *  4. SOLIDS in the loop: a character stops at a solid and slides along it; a brain's `hitSolid`
 *     fires off the loop's own solid step.
 *  5. FLOW: `setCharacterState` / `setCharacterControl` by instance and by tag; `characterState` on
 *     a brain transition (not on Flow's own override); bad payloads are ignored.
 *  6. THE LOOKS: `animInputs` reach the instance (speed, vx, vy, facing, moving, state:<id>), each
 *     only when it changed.
 *  7. SHOTS: `shootAt` spawns through the game's spawner and the shot flies; the bake seeds the
 *     characters' components (`characterComponentIds` in `runtimeBundle.ts` / `editorArtExport.ts`).
 *  8. THE SAMPLE, played headless on the real interpreter and loop: the guard patrols its path,
 *     the runner steers and stops at walls, the guard spots, chases and catches it, gives up beyond
 *     320 px, the round ends and restarts; its look gets `speed` / `chasing`; a seed replays.
 *  9. THE SAMPLE IS ONE PIECE: the flow validates clean, the config validates, the layout's path is
 *     the brain's, the guard's look is a valid 1D blend on `speed`, and every piece names the same
 *     components.
 * 13. ABILITIES (P11.5): a played character uses one on the input map's `ability1`; a brain uses
 *     one whenever a target is in reach; Flow's `useAbility` uses one once; a stun holds its target
 *     (it neither steers nor moves); a catch hides it, it touches nothing, and it is back where it
 *     spawned; the vocabulary declares `useAbility` and its buttons; a config without abilities
 *     builds no stage (no signal, nothing culled).
 * 10. THE GAME (source-scanned): `apps/lines` gives the loop its characters' input only for a config
 *     with characters, and reads keys through the flow's own key map.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Container } from 'pixi.js';

import {
	ARCADE_CHARACTER_CONTROLS,
	ARCADE_FIELD_LAYER,
	ARCADE_SCREENS,
	ARCADE_VOCAB,
	ARCADE_DRIVEN_SEED_DOC,
	awaitCompleteContainerIds,
	createContainerMountModel,
	createFlowState,
	createFlowV2Env,
	createSpawnStore,
	runFlowEvent,
	runFlowStateEntry,
	spawnedIdOf,
	stepFlowState,
	validateFlowDoc,
	type FlowDoc,
	type SpawnedInstance,
} from 'engine-flow-v2';
import { CHARACTER_CONTROLS } from 'engine-game/src/game/arcadeCharacters';
import { ABILITY_BUTTONS, ABILITY_SIGNALS } from 'engine-game/src/game/arcadeAbilities';
import { createArcadeLoop, type ArcadeRules } from 'engine-game/src/game/arcadeLoop';
import {
	ComponentStateMachineRunner,
	arcadeReferenceLayout,
	sceneCamera,
	sceneSpawnLayers,
	scenePaths,
	sceneWorld,
	spawnLayerSpec,
	validateStateMachine,
	worldCameraScene,
	type Scene,
} from 'engine-layout';
import {
	BEHAVIOURS,
	BEHAVIOUR_DEFAULTS,
	CONDITIONS,
	CONTROLLER_ACTIONS,
	RANDOM_EVERY,
	nearestDistance,
	pointAt,
	samplePath,
	PATH_LEAD,
} from 'engine-mechanics';
import {
	ARCADE_BEHAVIOURS,
	ARCADE_CONDITIONS,
	ARCADE_CONTROLLER_ACTIONS,
	DEFAULT_ARCADE_RANDOM_EVERY,
	DEFAULT_ARCADE_TARGET_TAG,
	characterComponentIds,
	normalizeGameConfigDoc,
	resolveArcade,
	validateGameConfigDoc,
	type ArcadeBody,
	type ArcadeCharacter,
	type GameConfigDoc,
} from 'game-config';

import { projectSpawnLayers } from '../src/lib/flowV2Projection.ts';
import {
	registerSpawnLayerSpace,
	spawnLayerPoint,
} from '../../../packages/engine-layout/src/lib/spawnLayers.ts';
import {
	ARCADE_GUARD,
	ARCADE_GUARD_COMPONENTS,
	ARCADE_GUARD_LOOK,
	ARCADE_GUARD_ROUTE,
	ARCADE_GUARD_TIMELINES,
	ARCADE_GUARD_WORLD,
	arcadeGuardReferenceLayout,
} from '../../../packages/engine-layout/src/lib/referenceLayouts/arcadeGuard.ts';
import {
	ARCADE_GUARD_SEED_DOC,
	GUARD_PLACES,
	GUARD_SAMPLE,
	GUARD_STATES,
} from '../../../packages/engine-flow-v2/src/reference/arcadeGuardSeed.ts';

let fails = 0;
let passes = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
	if (ok) {
		passes++;
		console.log(`  PASS  ${name}`);
	} else {
		fails++;
		console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

const ROOT = resolve(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const EMPTY_LIBRARY = { version: 2 as const, functions: [] };
const FRAME = 1000 / 60;
/** The desktop view a world camera frames. */
const VIEW = { w: 1422, h: 800 };
const DT = 1 / 60;
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const json = (v: unknown) => JSON.stringify(v);

type Io = {
	held: Set<string>;
	pointer?: { x: number; y: number };
	variables: Record<string, unknown>;
	inputs: { id: string; input: string; value: unknown }[];
	order: string[];
	reads: number;
	paths: Record<
		string,
		{ points: { x: number; y: number }[]; closed?: boolean; smoothing?: number }
	>;
};

const newIo = (): Io => ({
	held: new Set(),
	variables: {},
	inputs: [],
	order: [],
	reads: 0,
	paths: {},
});

const box = (w: number, h: number, tags: string[], solid = false): ArcadeBody => ({
	shape: 'box',
	w,
	h,
	tags,
	...(solid ? { solid: true as const } : {}),
});

/** A loop over a real spawn store with one free layer, for the loop-level checks. */
const bench = (
	characters: ArcadeCharacter[],
	bodies: Record<string, ArcadeBody>,
	pairs: [string, string][] = [],
	field = { w: 1000, h: 800 },
	extra: Pick<ArcadeRules, 'abilities' | 'forces' | 'zones'> = {},
) => {
	const store = createSpawnStore();
	const components = [
		...new Set([...Object.keys(bodies), ...characterComponentIds({ arcade: { characters } })]),
	];
	store.declare({ id: 'f', spawnable: components, placement: 'free', cap: 200 });
	const io = newIo();
	const signals: { name: string; payload: Record<string, unknown> }[] = [];
	const rules: ArcadeRules = { fixedHz: 60, bodies, pairs, zones: [], characters, ...extra };
	const live = {
		...store,
		live: store.live,
		get: store.get,
		subscribe: store.subscribe,
		move: (moves: readonly { id: string; x: number; y: number }[]) => {
			io.order.push('move');
			store.move(moves);
		},
	};
	const loop = createArcadeLoop({
		rules,
		field: () => field,
		layers: () => store.layers(),
		live,
		seed: 'bench',
		signal: (name, payload) => {
			io.order.push(`signal:${name}`);
			signals.push({ name, payload });
		},
		input: {
			held: (action) => io.held.has(action),
			pointer: () => io.pointer,
		},
		paths: () => io.paths,
		variable: (id) => io.variables[id],
		setInstanceInput: (id, input, value) => {
			io.order.push('input');
			io.inputs.push({ id, input, value });
		},
		spawn: (layer, componentId, x, y) => {
			const r = store.spawn(layer, componentId, { x, y });
			return r.ok ? r.instance.id : undefined;
		},
	});
	const spawn = (componentId: string, x: number, y: number): SpawnedInstance => {
		const r = store.spawn('f', componentId, { x, y });
		if (!r.ok) throw new Error(`spawn refused: ${r.reason}`);
		return r.instance;
	};
	const body = (id: string) => loop.bodies().find((b) => b.id === id)!;
	const frames = (n: number) => {
		for (let i = 0; i < n; i++) loop.frame(FRAME);
	};
	return { store, loop, io, signals, spawn, body, frames };
};

// ── 1. parity: no characters ────────────────────────────────────────────────────────────────
const STARTER_CONFIG = normalizeGameConfigDoc(
	JSON.parse(read('apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json')),
) as GameConfigDoc;
const STARTER_LAYOUT = arcadeReferenceLayout();

/** One game: a flow on the real interpreter over the arcade loop and a real spawn store. */
const playFlow = (opts: {
	config: GameConfigDoc;
	layout: { scenes: Scene[] };
	doc: FlowDoc;
	seed: string;
	field: { w: number; h: number };
	withIo: boolean;
}) => {
	const store = createSpawnStore();
	for (const { node, sceneId } of sceneSpawnLayers(opts.layout.scenes))
		store.declare(spawnLayerSpec(node, sceneId));
	const doc = opts.doc;
	const flowState = createFlowState(doc);
	const mount = createContainerMountModel(
		doc.containers,
		undefined,
		awaitCompleteContainerIds(doc),
	);
	const signals: { name: string; payload: Record<string, unknown> }[] = [];
	const pending: Promise<unknown>[] = [];
	const io = newIo();
	const paths: Io['paths'] = {};
	for (const scene of opts.layout.scenes) Object.assign(paths, scenePaths(scene));
	const rules = resolveArcade(opts.config);
	// The play field's screen's world camera, as `apps/lines` attaches it (P10.12); none for a
	// layout without one.
	const cameraScene = worldCameraScene(opts.layout.scenes);
	const loop = createArcadeLoop({
		rules,
		field: () => rules.field ?? opts.field,
		...(cameraScene
			? {
					camera: {
						spec: sceneCamera(cameraScene),
						world: sceneWorld(cameraScene),
						view: () => VIEW,
					},
				}
			: {}),
		layers: () => store.layers(),
		live: store,
		seed: opts.seed,
		signal: (name, payload) => {
			signals.push({ name, payload });
			pending.push(runFlowEvent(doc, ctx, name, payload));
		},
		...(opts.withIo
			? {
					input: {
						held: (action: string) => {
							io.reads++;
							return io.held.has(action);
						},
						pointer: () => {
							io.reads++;
							return io.pointer;
						},
					},
					paths: () => {
						io.reads++;
						return paths;
					},
					variable: (id: string) => {
						io.reads++;
						return flowState.read(id);
					},
					setInstanceInput: (id: string, input: string, value: unknown) =>
						void io.inputs.push({ id, input, value }),
					spawn: (layer: string, componentId: string, x: number, y: number) => {
						io.reads++;
						const r = store.spawn(layer, componentId, { x, y });
						return r.ok ? r.instance.id : undefined;
					},
				}
			: {}),
	});
	const env = createFlowV2Env({
		mount,
		effect: (name) => loop.effects[name],
		broadcast: () => {},
		waitForTimeout: async () => {},
		timeScale: () => 1,
		engineRead: (key) => loop.value(key),
		state: flowState,
		spawn: (layer, componentId, at) => {
			const r = store.spawn(layer, componentId, at);
			return r.ok ? r.instance : undefined;
		},
		despawn: (instance) => void store.despawn(spawnedIdOf(instance) ?? ''),
		liveInstances: (layer) => store.live(layer),
	});
	const ctx = { vocab: ARCADE_VOCAB, library: EMPTY_LIBRARY, env };
	const drain = async () => {
		for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
		pending.length = 0;
	};
	const frame = async () => {
		loop.frame(FRAME);
		stepFlowState(
			flowState,
			FRAME,
			(entry) => void pending.push(runFlowStateEntry(doc, ctx, entry)),
		);
		await drain();
	};
	const frames = async (n: number) => {
		for (let i = 0; i < n; i++) await frame();
	};
	const event = async (name: string) => {
		pending.push(runFlowEvent(doc, ctx, name, {}));
		await drain();
	};
	const key = async (action: string, phase: 'down' | 'up') => {
		if (phase === 'down') io.held.add(action);
		else io.held.delete(action);
		pending.push(runFlowStateEntry(doc, ctx, { kind: 'input', action, phase }));
		await drain();
	};
	const start = async () => {
		await event('load');
		await event('tapToStart');
		await frames(6);
	};
	const live = () => store.live(ARCADE_FIELD_LAYER);
	const of = (componentId: string) => live().filter((i) => i.componentId === componentId);
	const body = (id: string) => loop.bodies().find((b) => b.id === id);
	return {
		store,
		loop,
		mount,
		flowState,
		signals,
		io,
		frame,
		frames,
		event,
		key,
		start,
		live,
		of,
		body,
		drain,
	};
};

{
	const run = async (withIo: boolean) => {
		const game = playFlow({
			config: STARTER_CONFIG,
			layout: STARTER_LAYOUT,
			doc: ARCADE_DRIVEN_SEED_DOC,
			seed: 'parity',
			field: { w: 1422, h: 800 },
			withIo,
		});
		await game.start();
		await game.key('left', 'down');
		await game.frames(40);
		await game.key('left', 'up');
		await game.key('right', 'down');
		await game.frames(200);
		await game.key('right', 'up');
		await game.frames(200);
		return {
			game,
			trace: json({
				bodies: game.loop.bodies(),
				signals: game.signals.map((s) => [s.name, s.payload]),
				vars: ['score', 'lives', 'playing'].map((v) => game.flowState.read(v)),
				steps: game.loop.steps,
			}),
		};
	};
	const bare = await run(false);
	const handed = await run(true);
	check(
		'1. the P10.8 starter has no characters',
		resolveArcade(STARTER_CONFIG).characters.length === 0,
	);
	check(
		'1. it reaches the same bodies and signals with or without the characters’ input handed in',
		bare.trace === handed.trace && bare.game.signals.length > 0,
	);
	check(
		'1. …and never reads the input, paths, variables or spawner, nor sets a look input',
		handed.game.io.reads === 0 && handed.game.io.inputs.length === 0,
		`${handed.game.io.reads} reads, ${handed.game.io.inputs.length} inputs`,
	);
	check(
		'1. its bodies carry no brain state',
		bare.game.loop.bodies().every((b) => !('state' in b)),
	);
	const src = read('packages/engine-game/src/game/arcadeLoop.ts');
	check(
		'1. without a characters stage the step is P10.8’s `step(list, …)` (source)',
		/if \(characters\) for \(const id of characters\.move\(list, clock\.dt, area\)\) moved\.add\(id\);\s*else step\(list, clock\.dt, area\);/.test(
			src,
		) && /if \(rules\.characters\?\.length\)\s*characters = createCharacterStage/.test(src),
	);
}

// ── 2. the stage order ───────────────────────────────────────────────────────────────────────
{
	const runner: ArcadeCharacter = {
		id: 'runner',
		component: 'hero',
		controller: { kind: 'topDown', speed: 240 },
		animInputs: { speed: 'speed' },
	};
	const walker: ArcadeCharacter = {
		id: 'walker',
		component: 'walker',
		brain: {
			initial: 'a',
			states: [
				{ id: 'a', behaviour: 'idle' },
				{ id: 'b', behaviour: 'idle' },
			],
			transitions: [{ id: 'go', from: 'a', to: 'b', when: [] }],
		},
	};
	const b = bench([runner, walker], {
		hero: box(20, 20, ['player']),
		walker: box(20, 20, ['npc']),
		rock: box(20, 20, ['rock']),
		wall: box(40, 400, ['wall'], true),
	});
	const hero = b.spawn('hero', 100, 100);
	b.spawn('walker', 600, 600);
	const rock = b.spawn('rock', 300, 100);
	b.loop.effects.setVelocity({ instance: rock, vx: 120 });
	b.spawn('wall', 330, 300);
	b.io.held.add('right');
	b.frames(1);
	check(
		'2. a controller sets the velocity before the step moves it (one step: speed · dt)',
		near(b.body(hero.id).x, 100 + 240 * DT) && b.body(hero.id).vx === 240,
		json(b.body(hero.id)),
	);
	check(
		'2. a body that is no character steps as P10.8, through a solid',
		near(b.body(rock.id).x, 300 + 120 * DT),
	);
	b.frames(20);
	check(
		'2. …a non-character is never stopped by a solid',
		near(b.body(rock.id).x, 300 + 120 * 21 * DT),
		String(b.body(rock.id).x),
	);
	const first = b.io.order.slice(0, 4);
	check(
		'2. after a frame: positions, then the looks’ inputs, then the signals',
		json(first) === json(['move', 'input', 'signal:characterState', 'move']),
		json(b.io.order.slice(0, 6)),
	);
	check(
		'2. the signal comes after the frame that raised it, with the character’s handle',
		b.signals[0]?.name === 'characterState' &&
			json(b.signals[0].payload.from) === '"a"' &&
			(b.signals[0].payload.instance as SpawnedInstance).componentId === 'walker' &&
			b.signals[0].payload.character === 'walker',
		json(b.signals[0]?.payload),
	);
}

// ── 3. controllers follow the input map ──────────────────────────────────────────────────────
{
	const top: ArcadeCharacter = {
		id: 'top',
		component: 'top',
		controller: { kind: 'topDown', speed: 300 },
	};
	const side: ArcadeCharacter = {
		id: 'side',
		component: 'side',
		controller: { kind: 'sideScroll', speed: 200 },
	};
	const paddle: ArcadeCharacter = {
		id: 'paddle',
		component: 'paddle',
		controller: { kind: 'pointer', axes: 'x', speed: 900 },
	};
	const heavy: ArcadeCharacter = {
		id: 'heavy',
		component: 'heavy',
		controller: { kind: 'topDown', speed: 300 },
		movement: { accel: 600 },
	};
	const b = bench([top, side, paddle, heavy], {
		top: box(20, 20, ['p']),
		side: box(20, 20, ['p']),
		paddle: box(100, 20, ['p']),
		heavy: box(20, 20, ['p']),
	});
	const t = b.spawn('top', 500, 400);
	const s = b.spawn('side', 500, 200);
	const p = b.spawn('paddle', 100, 700);
	const h = b.spawn('heavy', 200, 200);
	b.io.held.add('up');
	b.io.held.add('right');
	b.frames(1);
	const tv = b.body(t.id);
	check(
		'3. topDown: up + right is a diagonal no faster than a straight line',
		near(Math.hypot(tv.vx, tv.vy), 300) && tv.vx > 0 && tv.vy < 0,
		json(tv),
	);
	check(
		'3. sideScroll: right moves it across, up does nothing',
		b.body(s.id).vx === 200 && b.body(s.id).vy === 0,
	);
	check(
		'3. movement: accel limits how fast a controller gets up to speed',
		near(Math.hypot(b.body(h.id).vx, b.body(h.id).vy), 600 * DT),
	);
	check('3. pointer: no pointer down, the paddle stays', b.body(p.id).vx === 0);
	b.io.held.clear();
	b.frames(1);
	check(
		'3. letting go stops the keyboard characters',
		b.body(t.id).vx === 0 && b.body(s.id).vx === 0,
	);
	b.io.pointer = { x: 640, y: 100 };
	let passed = false;
	for (let i = 0; i < 60; i++) {
		b.frames(1);
		if (b.body(p.id).x > 640 + 1e-9) passed = true;
	}
	check(
		'3. pointer: the paddle follows on x only and arrives without overshooting',
		near(b.body(p.id).x, 640) && b.body(p.id).y === 700 && !passed,
		json(b.body(p.id)),
	);
	const tBefore = b.body(t.id);
	b.frames(1);
	const tAfter = b.body(t.id);
	check(
		'3. a held touch steers a keyboard character towards it (no key held)',
		tAfter.x > tBefore.x && tAfter.y < tBefore.y,
		json([tBefore, tAfter]),
	);
}

// ── 4. solids in the loop ────────────────────────────────────────────────────────────────────
{
	const hero: ArcadeCharacter = {
		id: 'hero',
		component: 'hero',
		controller: { kind: 'topDown', speed: 300 },
	};
	const bumper: ArcadeCharacter = {
		id: 'bumper',
		component: 'bumper',
		brain: {
			initial: 'walk',
			states: [
				{ id: 'walk', behaviour: 'chase', params: { tag: 'goal', range: 2000, speed: 150 } },
				{ id: 'stuck', behaviour: 'idle' },
			],
			transitions: [{ id: 'bump', from: 'walk', to: 'stuck', when: [{ kind: 'hitSolid' }] }],
		},
	};
	const b = bench([hero, bumper], {
		hero: box(20, 20, ['player']),
		bumper: box(20, 20, ['npc']),
		goal: box(10, 10, ['goal']),
		wall: box(40, 400, ['wall'], true),
	});
	b.spawn('wall', 500, 400);
	const p = b.spawn('hero', 400, 300);
	b.io.held.add('right');
	b.io.held.add('down');
	b.frames(60);
	const pb = b.body(p.id);
	check(
		'4. a character driven diagonally into a wall stops at it',
		pb.x === 470 && pb.vx === 0,
		json(pb),
	);
	check(
		'4. …and slides along it at its along-wall speed',
		near(pb.y, 300 + 60 * 300 * Math.SQRT1_2 * DT) && near(pb.vy, 300 * Math.SQRT1_2),
		json(pb),
	);
	b.io.held.clear();
	b.spawn('goal', 900, 300);
	const g = b.spawn('bumper', 300, 300);
	b.frames(240);
	check(
		'4. a brain walking into a wall: hitSolid fires its transition',
		b.signals.some(
			(s) => s.name === 'characterState' && s.payload.from === 'walk' && s.payload.to === 'stuck',
		) && b.body(g.id).state === 'stuck',
		json(b.body(g.id)),
	);
	check('4. …stopped at the wall', b.body(g.id).x <= 470, String(b.body(g.id).x));
}

// ── 5. Flow's actions and the signal ─────────────────────────────────────────────────────────
{
	const guard: ArcadeCharacter = {
		id: 'guard',
		component: 'guard',
		controller: { kind: 'topDown', speed: 100 },
		brain: {
			initial: 'still',
			states: [
				{ id: 'still', behaviour: 'idle' },
				{ id: 'drift', behaviour: 'wander', params: { speed: 50 } },
				{ id: 'later', behaviour: 'idle' },
			],
			transitions: [{ id: 'tick', from: 'drift', to: 'later', when: [{ kind: 'timer', ms: 500 }] }],
		},
	};
	const b = bench([guard], { guard: box(20, 20, ['guard']), crate: box(20, 20, ['guard']) });
	const one = b.spawn('guard', 200, 200);
	const two = b.spawn('guard', 600, 200);
	const crate = b.spawn('crate', 400, 400);
	b.frames(1);
	check(
		'5. a character with a controller is played by default (not its brain)',
		b.body(one.id).state === 'still',
	);
	b.loop.effects.setCharacterState({ instance: one, state: 'drift' });
	b.frames(1);
	check(
		'5. setCharacterState (instance): that one enters the state, the other keeps its own',
		b.body(one.id).state === 'drift' && b.body(two.id).state === 'still',
	);
	check(
		'5. …and Flow’s own override raises no characterState',
		b.signals.every((s) => s.name !== 'characterState'),
	);
	b.loop.effects.setCharacterState({ tagged: 'guard', state: 'later' });
	b.loop.effects.setCharacterState({ tagged: 'guard', state: 'nowhere' });
	b.loop.effects.setCharacterState({ tagged: 'guard' });
	b.frames(1);
	check(
		'5. setCharacterState (tagged): every character carrying the tag; an unknown state is ignored',
		b.body(one.id).state === 'later' &&
			b.body(two.id).state === 'later' &&
			!('state' in b.body(crate.id)),
	);
	b.loop.effects.setCharacterState({ instance: one, state: 'drift' });
	b.frames(40);
	check(
		'5. while played, the brain does not run (no transition, no wander)',
		b.body(one.id).state === 'drift' && b.body(one.id).vx === 0,
	);
	b.loop.effects.setCharacterControl({ instance: one, control: 'brain' });
	b.frames(40);
	check(
		'5. setCharacterControl brain: it runs its brain (a bot), and its transitions signal',
		b.body(one.id).state === 'later' &&
			b.signals.some(
				(s) =>
					s.name === 'characterState' &&
					(s.payload.instance as SpawnedInstance).id === one.id &&
					s.payload.from === 'drift' &&
					s.payload.to === 'later',
			),
		json([b.body(one.id), b.signals.map((s) => s.name)]),
	);
	b.loop.effects.setCharacterControl({ tagged: 'guard', control: 'controller' });
	b.loop.effects.setCharacterControl({ tagged: 'guard', control: 'robot' });
	b.io.held.add('left');
	b.frames(1);
	check(
		'5. setCharacterControl controller (tagged): played again; a bad control is ignored',
		b.body(one.id).vx === -100 && b.body(two.id).vx === -100 && b.body(crate.id).vx === 0,
	);
}

// ── 6. the looks ─────────────────────────────────────────────────────────────────────────────
{
	const walker: ArcadeCharacter = {
		id: 'walker',
		component: 'walker',
		controller: { kind: 'sideScroll', speed: 120 },
		brain: { initial: 'calm', states: [{ id: 'calm', behaviour: 'idle' }], transitions: [] },
		animInputs: {
			s: 'speed',
			vx: 'vx',
			vy: 'vy',
			f: 'facing',
			m: 'moving',
			calm: 'state:calm',
			other: 'state:other',
		},
	};
	const b = bench([walker], { walker: box(20, 20, ['w']) });
	const w = b.spawn('walker', 500, 400);
	b.frames(1);
	const first = Object.fromEntries(b.io.inputs.map((i) => [i.input, i.value]));
	check(
		'6. the first frame hands every animInput its value',
		json(first) === json({ s: 0, vx: 0, vy: 0, f: 1, m: false, calm: true, other: false }) &&
			b.io.inputs.every((i) => i.id === w.id),
		json(first),
	);
	b.frames(10);
	check('6. …and nothing again while nothing changes', b.io.inputs.length === 7);
	b.io.held.add('left');
	b.frames(1);
	const moved = b.io.inputs.slice(7).map((i) => [i.input, i.value]);
	check(
		'6. moving left: speed, vx, facing and moving change — only they are sent',
		json(moved) ===
			json([
				['s', 120],
				['vx', -120],
				['f', -1],
				['m', true],
			]),
		json(moved),
	);
	b.io.held.clear();
	b.frames(1);
	const stopped = b.io.inputs.slice(11).map((i) => [i.input, i.value]);
	check(
		'6. stopping: facing stays left',
		json(stopped) ===
			json([
				['s', 0],
				['vx', 0],
				['m', false],
			]),
		json(stopped),
	);
}

// ── 7. shots and shipping ────────────────────────────────────────────────────────────────────
{
	const turret: ArcadeCharacter = {
		id: 'turret',
		component: 'turret',
		brain: {
			initial: 'aim',
			states: [
				{
					id: 'aim',
					behaviour: 'shootAt',
					params: { component: 'bolt', layer: 'f', every: 500, speed: 400, range: 700 },
				},
			],
			transitions: [],
		},
	};
	const b = bench([turret], {
		turret: box(30, 30, ['enemy']),
		target: box(20, 20, ['player']),
		bolt: { shape: 'circle', r: 5, tags: ['shot'], edges: 'pass' },
	});
	b.spawn('target', 800, 300);
	b.spawn('turret', 300, 300);
	b.frames(61);
	const bolts = b.store.live('f').filter((i) => i.componentId === 'bolt');
	check(
		'7. shootAt spawns through the game’s spawner, every `every` ms',
		bolts.length === 3,
		String(bolts.length),
	);
	const firstBolt = b.body(bolts[0].id);
	check(
		'7. …and the shot flies at the target at its speed',
		firstBolt.vx === 400 && firstBolt.vy === 0 && firstBolt.x > 300 + 400 * 0.9,
		json(firstBolt),
	);
	check(
		'7. characterComponentIds names the look and the shot',
		json(characterComponentIds({ arcade: { characters: [turret] } })) === json(['turret', 'bolt']),
	);
	const bundle = read('apps/launcher-api/src/lib/server/runtimeBundle.ts');
	const art = read('apps/launcher-api/src/lib/server/editorArtExport.ts');
	check(
		'7. the bake seeds them: runtimeBundle.ts and editorArtExport.ts read characterComponentIds',
		/characterComponentIds\(gameConfig\)/.test(bundle) &&
			/characterComponentIds\(gameConfig\)/.test(art),
	);
}

// ── 8. the sample, played ────────────────────────────────────────────────────────────────────
const GUARD_CONFIG = normalizeGameConfigDoc(
	JSON.parse(read('packages/engine-mechanics/fixtures/arcade-guard.rules.json')),
) as GameConfigDoc;
const GUARD_LAYOUT = arcadeGuardReferenceLayout();

const playGuard = (seed: string) => {
	const game = playFlow({
		config: GUARD_CONFIG,
		layout: GUARD_LAYOUT,
		doc: ARCADE_GUARD_SEED_DOC,
		seed,
		field: { w: 1422, h: 800 },
		withIo: true,
	});
	const one = (componentId: string) => game.of(componentId)[0];
	const runner = () => game.body(one(GUARD_SAMPLE.runner).id)!;
	const guard = () => game.body(one(GUARD_SAMPLE.guard).id)!;
	const vars = () => ({
		lives: game.flowState.read('lives') as number,
		spotted: game.flowState.read('spotted') as number,
		playing: game.flowState.read('playing') as boolean,
	});
	const moveRunner = async (x: number, y: number) => {
		game.loop.effects.moveTo({ instance: one(GUARD_SAMPLE.runner), x, y });
		await game.frame();
	};
	const lookOf = (input: string) =>
		game.io.inputs.filter((i) => i.id === one(GUARD_SAMPLE.guard)?.id && i.input === input);
	return { ...game, runner, guard, vars, moveRunner, lookOf, one };
};

const route = samplePath({
	points: [...ARCADE_GUARD_ROUTE.points],
	closed: true,
	smoothing: ARCADE_GUARD_ROUTE.smoothing,
});
const offRoute = (b: { x: number; y: number }) => {
	const p = pointAt(route, nearestDistance(route, b.x, b.y));
	return Math.hypot(p.x - b.x, p.y - b.y);
};

{
	const game = playGuard('yard');
	await game.start();
	check(
		'8. a round: three lives, nothing spotted, the yard built',
		json(game.vars()) === json({ lives: 3, spotted: 0, playing: true }) &&
			game.of(GUARD_SAMPLE.wallH).length === 3 &&
			game.of(GUARD_SAMPLE.wallV).length === 2 &&
			game.of(GUARD_SAMPLE.runner).length === 1 &&
			game.of(GUARD_SAMPLE.guard).length === 1,
		json([game.vars(), game.live().map((i) => i.componentId)]),
	);
	const g0 = game.guard();
	await game.frames(120);
	const g1 = game.guard();
	check(
		'8. the guard patrols its path: it moves, and keeps to the route',
		g1.state === GUARD_STATES.patrol &&
			Math.hypot(g1.x - g0.x, g1.y - g0.y) > 100 &&
			offRoute(g1) <= PATH_LEAD + 2,
		json([g0, g1, offRoute(g1)]),
	);
	const speeds = game.lookOf(ARCADE_GUARD_LOOK.inputs.speed).map((i) => i.value as number);
	check(
		'8. its look is handed `speed` as it walks (the blend’s input), and `chasing` false',
		speeds.length > 2 &&
			speeds.some((v) => v > 100) &&
			json(game.lookOf(ARCADE_GUARD_LOOK.inputs.chasing).map((i) => i.value)) === '[false]',
		json(speeds.slice(0, 8)),
	);
	const r0 = game.runner();
	await game.key('right', 'down');
	await game.frames(30);
	await game.key('right', 'up');
	const r1 = game.runner();
	check(
		'8. the arrow keys steer the runner (right: 280 px/s)',
		near(r1.x, r0.x + 140) && r1.y === r0.y,
		json([r0, r1]),
	);
	await game.frames(2);
	check('8. …letting go stops it', game.runner().vx === 0 && game.runner().x === r1.x);
	await game.moveRunner(240, 470);
	await game.key('up', 'down');
	await game.frames(30);
	await game.key('up', 'up');
	check(
		'8. a wall stops the runner',
		game.runner().y === 400 + 18 + 22 && game.runner().x === 240,
		json(game.runner()),
	);
	// Into the guard's sight (within 220 px), clear of every wall.
	const g = game.guard();
	await game.moveRunner(g.x + (g.x < 711 ? -150 : 150), g.y < 400 ? g.y + 120 : g.y - 120);
	await game.frames(3);
	check(
		'8. within 220 px the guard spots the runner: characterState patrol → chase, SPOTTED 1',
		game.signals.some(
			(s) => s.name === 'characterState' && s.payload.from === 'patrol' && s.payload.to === 'chase',
		) &&
			game.guard().state === GUARD_STATES.chase &&
			game.vars().spotted === 1,
		json([game.guard(), game.runner(), game.vars()]),
	);
	check(
		'8. …and its look is told it is chasing',
		game.lookOf(ARCADE_GUARD_LOOK.inputs.chasing).at(-1)?.value === true,
	);
	let caught = false;
	for (let i = 0; i < 240 && !caught; i++) {
		await game.frame();
		caught = game.vars().lives === 2;
	}
	check(
		'8. the guard catches a runner that stands still: a life',
		caught,
		json([game.guard(), game.runner()]),
	);
	check(
		'8. …the runner is back at the start and the guard back on patrol',
		game.runner().x === GUARD_PLACES.runner.x &&
			game.runner().y === GUARD_PLACES.runner.y &&
			game.guard().state === GUARD_STATES.patrol,
		json([game.runner(), game.guard()]),
	);
	// Spotted again, then away beyond 320 px: it gives up.
	await game.frames(30);
	const h = game.guard();
	await game.moveRunner(h.x + (h.x < 711 ? -150 : 150), h.y < 400 ? h.y + 120 : h.y - 120);
	await game.frames(2);
	const spottedAgain = game.guard().state === GUARD_STATES.chase;
	await game.moveRunner(GUARD_PLACES.runner.x, GUARD_PLACES.runner.y);
	const far = Math.hypot(game.guard().x - game.runner().x, game.guard().y - game.runner().y);
	await game.frames(2);
	check(
		'8. beyond 320 px the guard gives up: chase → patrol',
		spottedAgain &&
			far > 320 &&
			game.guard().state === GUARD_STATES.patrol &&
			game.signals.some(
				(s) =>
					s.name === 'characterState' && s.payload.from === 'chase' && s.payload.to === 'patrol',
			),
		json([spottedAgain, far, game.guard()]),
	);
	// Caught twice more: the round is over.
	for (let n = 0; n < 2; n++) {
		const at = game.guard();
		await game.moveRunner(at.x + (at.x < 711 ? -120 : 120), at.y < 400 ? at.y + 100 : at.y - 100);
		for (let i = 0; i < 300 && game.vars().lives === 2 - n; i++) await game.frame();
		await game.frames(2);
	}
	check(
		'8. the third catch ends the round: the round-over screen holds',
		game.vars().lives === 0 &&
			!game.vars().playing &&
			game.vars().spotted >= 3 &&
			game.mount.isShown(ARCADE_SCREENS.over),
		json(game.vars()),
	);
	check(
		'8. …the guard rests (setCharacterState on every guard)',
		game.guard().state === GUARD_STATES.rest,
	);
	const still = game.runner();
	await game.key('left', 'down');
	await game.frames(20);
	await game.key('left', 'up');
	check(
		'8. …and the runner is handed to its brain, which stands (setCharacterControl)',
		game.runner().x === still.x && game.runner().state === 'stand',
		json([still, game.runner()]),
	);
	game.mount.complete(ARCADE_SCREENS.over);
	await game.drain();
	await game.frames(6);
	check(
		'8. the tap clears the yard and starts a new round',
		json(game.vars()) === json({ lives: 3, spotted: 0, playing: true }) &&
			game.live().length === GUARD_PLACES.walls.length + 2 &&
			game.runner().x === GUARD_PLACES.runner.x,
		json([game.vars(), game.live().map((i) => i.componentId)]),
	);
	await game.key('up', 'down');
	await game.frames(10);
	await game.key('up', 'up');
	check(
		'8. …where the new runner is played again',
		game.runner().y < GUARD_PLACES.runner.y,
		json(game.runner()),
	);
	game.io.pointer = { x: 600, y: 760 };
	const before = game.runner();
	await game.frames(10);
	game.io.pointer = undefined;
	check(
		'8. a held touch steers the runner too',
		game.runner().x > before.x && game.runner().y > before.y,
		json([before, game.runner()]),
	);
}

{
	const script = async (seed: string) => {
		const game = playGuard(seed);
		await game.start();
		await game.frames(30);
		await game.key('right', 'down');
		await game.key('up', 'down');
		await game.frames(45);
		await game.key('up', 'up');
		await game.frames(40);
		await game.key('right', 'up');
		await game.frames(200);
		return json({
			bodies: game.loop.bodies(),
			signals: game.signals.map((s) => [s.name, s.payload]),
			looks: game.io.inputs,
			vars: game.vars(),
		});
	};
	const a = await script('replay');
	check(
		'8. a seed replays: the same keys at the same frames reach the same yard',
		a === (await script('replay')),
	);
}

// ── 9. the sample is one piece ───────────────────────────────────────────────────────────────
{
	const defs = Object.fromEntries(ARCADE_GUARD_COMPONENTS.map((d) => [d.id, d]));
	const layers = projectSpawnLayers(
		ARCADE_GUARD_SEED_DOC.containers,
		GUARD_LAYOUT.scenes,
		(id) => defs[id],
	);
	const issues = validateFlowDoc(
		ARCADE_GUARD_SEED_DOC,
		ARCADE_VOCAB,
		EMPTY_LIBRARY,
		undefined,
		undefined,
		GUARD_LAYOUT.scenes.map((s) => s.id),
		undefined,
		'rules',
		layers,
	);
	check(
		'9. the sample flow validates clean as a rules game over its scene set',
		issues.length === 0,
		json(issues.map((i) => `${i.code}@${i.node ?? ''}`)),
	);
	const configIssues = validateGameConfigDoc(GUARD_CONFIG);
	check('9. the sample config validates clean', configIssues.length === 0, json(configIssues));
	const characters = resolveArcade(GUARD_CONFIG).characters;
	check(
		'9. it has the runner (played, a standing brain) and the guard (patrol / chase / rest)',
		json(characters.map((c) => [c.id, !!c.controller, c.brain?.states.map((s) => s.id)])) ===
			json([
				['runner', true, ['stand']],
				['guard', false, ['patrol', 'chase', 'rest']],
			]),
	);
	const paths = scenePaths(GUARD_LAYOUT.scenes.find((s) => s.id === 'basegame')!);
	const patrol = characters[1].brain?.states.find((s) => s.id === 'patrol');
	check(
		'9. the layout’s path is the one the guard’s patrol names',
		patrol?.params?.path === ARCADE_GUARD_ROUTE.id &&
			json(paths[ARCADE_GUARD_ROUTE.id]?.points) === json(ARCADE_GUARD_ROUTE.points) &&
			paths[ARCADE_GUARD_ROUTE.id].closed,
	);
	const guardDef = defs[ARCADE_GUARD.guard];
	const smIssues = validateStateMachine(
		guardDef,
		ARCADE_GUARD_TIMELINES.map((t) => t.id),
	).filter((i) => i.level === 'error');
	check('9. the guard’s look: its state machine validates', smIssues.length === 0, json(smIssues));
	const durations = new Map(ARCADE_GUARD_TIMELINES.map((t) => [t.id, t.duration]));
	const runner = new ComponentStateMachineRunner(
		guardDef.stateMachine!,
		guardDef.inputs,
		durations,
	);
	runner.setInput('speed', ARCADE_GUARD_LOOK.runAt / 2);
	runner.advance(0);
	const play = runner.plays()[0];
	check(
		'9. …a 1D blend on `speed`: half run speed plays idle and run half and half',
		play.timeline === ARCADE_GUARD_LOOK.idle &&
			play.mix?.timeline === ARCADE_GUARD_LOOK.run &&
			near(play.mix.weight, 0.5),
		json(play),
	);
	check(
		'9. the config feeds the look’s inputs: speed ← speed, chasing ← state:chase',
		json(characters[1].animInputs) === json({ speed: 'speed', chasing: 'state:chase' }) &&
			json(guardDef.inputs?.map((i) => [i.id, i.kind])) ===
				json([
					['speed', 'number'],
					['chasing', 'bool'],
				]),
	);
	const field = sceneSpawnLayers(GUARD_LAYOUT.scenes);
	const components = Object.values(GUARD_SAMPLE).sort();
	check(
		'9. one spawn layer, listing exactly the sample’s components, each with a config body',
		field.length === 1 &&
			json([...field[0].node.spawnable].sort()) === json(components) &&
			json(Object.keys(defs).sort()) === json(components) &&
			json(Object.keys(GUARD_CONFIG.arcade?.bodies ?? {}).sort()) === json(components) &&
			json(Object.values(ARCADE_GUARD).sort()) === json(components),
	);
	check(
		'9. the walls are solid; the runner and the guard are not',
		GUARD_CONFIG.arcade?.bodies?.arcadeWallH?.solid === true &&
			GUARD_CONFIG.arcade?.bodies?.arcadeWallV?.solid === true &&
			!GUARD_CONFIG.arcade?.bodies?.arcadeRunner?.solid &&
			!GUARD_CONFIG.arcade?.bodies?.arcadeGuard?.solid,
	);
	check(
		'9. the bake ships the runner and the guard (characterComponentIds)',
		json(characterComponentIds(GUARD_CONFIG)) === json([GUARD_SAMPLE.runner, GUARD_SAMPLE.guard]),
	);
	check(
		'9. the flow’s key map has the four controller actions',
		json(ARCADE_GUARD_SEED_DOC.inputs?.map((i) => i.action)) ===
			json(['left', 'right', 'up', 'down']),
	);
}

// ── 10. the game ─────────────────────────────────────────────────────────────────────────────
{
	const arcade = read('apps/lines/src/game/arcade.ts');
	const stage = read('apps/lines/src/components/ArcadeStage.svelte');
	const runtime = read('apps/lines/src/game/flowV2Runtime.svelte.ts');
	check(
		'10. the game makes the characters’ side only for a config with characters',
		/if \(rules\.characters\.length\) characterIo = createCharacterRuntime\(rules\.characters\);/.test(
			arcade,
		) && /\.\.\.characterIo,/.test(arcade),
	);
	check(
		'10. …and attaches the keys and the pointer (detached with the play field) and reads the paths through it alone',
		/characterIo\?\.setScenes/.test(arcade) &&
			/canvas && characterIo \? characterIo\.attachInput/.test(arcade) &&
			/useArcadePaths\(/.test(stage) &&
			/useArcadeInput\(/.test(stage),
	);
	check(
		'10. held keys go through the flow’s own key map (one matcher for Flow and characters)',
		/keyActions: \(key\) => flowKeyActions\(doc\.inputs, key\)/.test(runtime) &&
			/flowKeyActions\(doc\.inputs, e\.key\)/.test(runtime) &&
			/getFlowV2\(\)\?\.keyActions\(key\)/.test(arcade),
	);
	check(
		'10. a look input goes through the Flow instance stash; a shot through the spawn store',
		/stashFlowInstanceInput\(id, input, value\)/.test(arcade) &&
			/live\.spawn\(layer, componentId/.test(arcade),
	);
	check(
		'10. the pointer is read in the spawn layer’s own space',
		/spawnLayerPoint\(layer, pressed\.x, pressed\.y\)/.test(arcade) &&
			/registerSpawnLayerSpace\(node\.id/.test(
				read('packages/engine-layout/src/lib/SpawnLayer.svelte'),
			),
	);
}

{
	// The lists each package keeps for itself (none of them depends on the others): a behaviour
	// `behaviours.js` gains but the config does not know would be dropped by the normalizer.
	const same = (a: readonly unknown[], b: readonly unknown[]) =>
		JSON.stringify(a) === JSON.stringify(b);
	check('12. the config knows every behaviour the brain runs', same(ARCADE_BEHAVIOURS, BEHAVIOURS));
	check('12. … and every condition', same(ARCADE_CONDITIONS, CONDITIONS));
	check(
		'12. the controllers read the config’s input-map actions',
		same(ARCADE_CONTROLLER_ACTIONS, CONTROLLER_ACTIONS),
	);
	check(
		'12. Flow’s control enum is the loop’s',
		same(ARCADE_CHARACTER_CONTROLS, CHARACTER_CONTROLS),
	);
	check(
		'12. a random condition’s default beat agrees',
		DEFAULT_ARCADE_RANDOM_EVERY === RANDOM_EVERY,
	);
	check(
		'12. the validator’s default chase / flee tag is the brain’s',
		DEFAULT_ARCADE_TARGET_TAG === BEHAVIOUR_DEFAULTS.chase.tag &&
			DEFAULT_ARCADE_TARGET_TAG === BEHAVIOUR_DEFAULTS.flee.tag,
	);
}

// ── 11. characters + camera ─────────────────────────────────────────────────────────────────
{
	/** A loop over a real store with a world camera following `player`, as `apps/lines` attaches
	 *  it; the layer `f` despawns what leaves the view when `despawn` is set. */
	const cameraBench = (characters: ArcadeCharacter[], despawn: boolean, smoothing?: number) => {
		const store = createSpawnStore();
		store.declare({
			id: 'f',
			spawnable: ['hero', 'walker', 'rock'],
			placement: 'free',
			cap: 50,
			...(despawn ? { despawnOutsideView: { margin: 0 } } : {}),
		});
		const io = newIo();
		const world = { w: 4000, h: 800 };
		const loop = createArcadeLoop({
			rules: {
				fixedHz: 60,
				bodies: {
					hero: box(20, 20, ['player']),
					walker: box(20, 20, ['npc']),
					rock: box(20, 20, ['rock']),
				},
				pairs: [],
				zones: [],
				characters,
			},
			field: () => world,
			layers: () => store.layers(),
			live: store,
			seed: 'camera',
			signal: () => {},
			camera: {
				spec: {
					follow: 'player',
					deadZone: { w: 200, h: 200 },
					...(smoothing ? { smoothing } : {}),
				},
				world,
				view: () => VIEW,
			},
			input: { held: (a) => io.held.has(a), pointer: () => io.pointer },
			setInstanceInput: (id, input, value) => void io.inputs.push({ id, input, value }),
		});
		const spawn = (componentId: string, x: number, y: number) => {
			const r = store.spawn('f', componentId, { x, y });
			if (!r.ok) throw new Error(r.reason);
			return r.instance;
		};
		const body = (id: string) => loop.bodies().find((b) => b.id === id);
		const frames = (n: number) => {
			for (let i = 0; i < n; i++) loop.frame(FRAME);
		};
		return { store, loop, io, spawn, body, frames };
	};
	const hero: ArcadeCharacter = {
		id: 'hero',
		component: 'hero',
		controller: { kind: 'topDown', speed: 600 },
	};
	const walker: ArcadeCharacter = {
		id: 'walker',
		component: 'walker',
		brain: {
			initial: 'walk',
			states: [{ id: 'walk', behaviour: 'patrol', params: { dx: 0, dy: 300, speed: 120 } }],
			transitions: [],
		},
		animInputs: { s: 'speed', vy: 'vy' },
	};

	// Follow the player character across the world.
	{
		const b = cameraBench([hero], false);
		const h = b.spawn('hero', 300, 400);
		b.frames(1);
		const c0 = b.loop.camera()!;
		b.io.held.add('right');
		b.frames(240);
		b.io.held.clear();
		b.frames(60);
		const c1 = b.loop.camera()!;
		const at = b.body(h.id)!;
		check(
			'11. the camera follows the player character across the world',
			c0.x === 0 && c1.x > 1500 && at.x > c1.x && at.x < c1.x + VIEW.w && at.x > 2000,
			json([c0, c1, at]),
		);
	}

	// The pointer, through the camera: the spawn layer's own transform includes the world
	// container `<LayoutScene>` moves by the camera (and its shake), so a canvas point maps to the
	// field point under it wherever the camera is.
	{
		const src = read('packages/engine-layout/src/lib/SpawnLayer.svelte');
		const scene = read('packages/engine-layout/src/lib/LayoutScene.svelte');
		check(
			'11. the spawn layer maps a pointer through its parent’s whole transform, and the world container (camera + shake) is an ancestor (source)',
			/registerSpawnLayerSpace\(node\.id, \(x, y\) => \{\s*const local = parent\.parent\.toLocal\(\{ x, y \}\);/.test(
				src,
			) &&
				/<Container x=\{view\.shakeX - view\.x\} y=\{view\.shakeY - view\.y\}>\s*\{@render sceneNodes\(\)\}/.test(
					scene,
				),
		);
		const b = cameraBench([hero], false);
		const h = b.spawn('hero', 300, 400);
		b.io.held.add('right');
		b.frames(200);
		b.io.held.clear();
		b.frames(60);
		b.loop.effects.cameraShake({ strength: 12, duration: 2000 });
		b.frames(3);
		const cam = b.loop.camera()!;
		// The game's tree, built as the layout draws it: the main box scales the design view onto the
		// canvas; the world container sits at the camera's view plus its shake; the spawn layer at 0, 0.
		const main = new Container();
		main.scale.set(0.5);
		main.position.set(40, 10);
		const worldContainer = new Container();
		worldContainer.position.set(cam.shakeX - cam.x, cam.shakeY - cam.y);
		main.addChild(worldContainer);
		const layerParent = new Container();
		worldContainer.addChild(layerParent);
		const off = registerSpawnLayerSpace('f', (x, y) => {
			const local = layerParent.toLocal({ x, y });
			return { x: local.x, y: local.y };
		});
		const press = { x: 40 + 0.5 * 700, y: 10 + 0.5 * 400 };
		const mapped = spawnLayerPoint('f', press.x, press.y)!;
		check(
			'11. a canvas point maps to the field point under it through a scrolled, shaking camera',
			cam.x > 1000 &&
				(cam.shakeX !== 0 || cam.shakeY !== 0) &&
				near(mapped.x, cam.x + 700 - cam.shakeX) &&
				near(mapped.y, cam.y + 400 - cam.shakeY),
			json([cam, mapped]),
		);
		b.loop.effects.cameraShake({ strength: 0, duration: 0 });
		b.frames(1);
		const still = b.loop.camera()!;
		worldContainer.position.set(still.shakeX - still.x, still.shakeY - still.y);
		const target = spawnLayerPoint('f', press.x, press.y)!;
		b.io.pointer = target;
		b.frames(90);
		const got = b.body(h.id)!;
		check(
			'11. …and a held touch there walks the runner to that field point',
			near(got.x, target.x, 1e-6) && near(got.y, target.y, 1e-6),
			json([target, got]),
		);
		off();
		check('11. an unmounted spawn layer maps nothing', spawnLayerPoint('f', 1, 1) === undefined);
	}

	// despawnOutsideView never takes the followed character; a brain character it does take is
	// forgotten whole (no stale actor: its looks stop).
	{
		const b = cameraBench([hero, walker], true, 2);
		const h = b.spawn('hero', 300, 400);
		const w = b.spawn('walker', 600, 300);
		b.frames(10);
		b.loop.effects.moveTo({ instance: h, x: 3600, y: 400 });
		b.frames(1);
		const cam = b.loop.camera()!;
		check(
			'11. the followed character, left behind by a lagging camera, is never despawned',
			cam.x + VIEW.w < 3600 - 20 && !!b.store.get(h.id) && !!b.body(h.id),
			json([cam, b.body(h.id)]),
		);
		b.frames(600);
		check(
			'11. …the camera catches it up; the brain character it left behind is despawned',
			b.loop.camera()!.x > 2000 && !!b.store.get(h.id) && !b.store.get(w.id) && !b.body(w.id),
			json([b.loop.camera(), b.loop.bodies()]),
		);
		const before = b.io.inputs.length;
		b.frames(30);
		check(
			'11. …and is forgotten: no look input for it after',
			b.io.inputs.slice(before).every((i) => i.id !== w.id) &&
				b.io.inputs.some((i) => i.id === w.id),
		);
	}

	// Culling only draws: a culled character still steps, runs its brain and gets its looks.
	{
		const b = cameraBench([hero, walker], false);
		b.spawn('hero', 300, 400);
		const w = b.spawn('walker', 3500, 200);
		b.frames(2);
		const y0 = b.body(w.id)!.y;
		const seen = b.io.inputs.filter((i) => i.id === w.id).length;
		b.frames(240);
		check(
			'11. a character out of view is culled…',
			b.loop.culled().has(w.id),
			json([...b.loop.culled()]),
		);
		check(
			'11. …and still steps on its brain, its looks still written',
			b.body(w.id)!.y !== y0 &&
				b.body(w.id)!.state === 'walk' &&
				b.io.inputs.filter((i) => i.id === w.id).length > seen,
			json([y0, b.body(w.id)]),
		);
	}

	// The sample, with its camera: it follows the runner, and replays.
	{
		const scene = worldCameraScene(GUARD_LAYOUT.scenes);
		check(
			'11. the sample’s play field has a world twice the view and a camera on the player',
			scene?.id === 'basegame' &&
				json(sceneWorld(scene)) === json(ARCADE_GUARD_WORLD) &&
				sceneCamera(scene)?.follow === 'player' &&
				json(GUARD_CONFIG.arcade?.field) === json(ARCADE_GUARD_WORLD),
		);
		const run = async () => {
			const game = playGuard('camera');
			await game.start();
			await game.key('right', 'down');
			await game.frames(60 * 7);
			await game.key('right', 'up');
			await game.frames(60);
			return { game, trace: json({ bodies: game.loop.bodies(), camera: game.loop.camera() }) };
		};
		const a = await run();
		const cam = a.game.loop.camera()!;
		const r = a.game.runner();
		check(
			'11. in the sample the camera follows the runner across the yard',
			cam.x > 500 && r.x > cam.x && r.x < cam.x + VIEW.w,
			json([cam, r]),
		);
		check(
			'11. …and the sample with its camera replays under a seed',
			a.trace === (await run()).trace,
		);
	}
}

// ── 13. abilities (P11.5) ────────────────────────────────────────────────────────────────────
{
	const bodies = { bearLook: box(40, 40, ['bear']), fishLook: box(20, 20, ['fish']) };
	const fish: ArcadeCharacter = {
		id: 'fish',
		component: 'fishLook',
		controller: { kind: 'topDown', speed: 100 },
	};
	const bear = (brain: boolean): ArcadeCharacter => ({
		id: 'bear',
		component: 'bearLook',
		...(brain
			? { brain: { initial: 'wait', states: [{ id: 'wait', behaviour: 'idle' }], transitions: [] } }
			: { controller: { kind: 'topDown', speed: 100 } }),
	});
	const abilities = resolveArcade({
		arcade: {
			abilities: [
				{
					character: 'bear',
					button: 'ability1',
					reach: 80,
					targets: ['fish'],
					effect: 'stun',
					ms: 500,
				},
				{
					character: 'bear',
					button: 'ability2',
					reach: 80,
					targets: ['fish'],
					effect: 'catch',
					ms: 500,
					score: 3,
				},
			],
		},
	}).abilities;

	// A played bear on `ability1`: the fish (played too, and holding right) is stunned in place.
	{
		const b = bench([bear(false), fish], bodies, [], undefined, { abilities });
		const bearAt = b.spawn('bearLook', 300, 300);
		const fishAt = b.spawn('fishLook', 350, 300);
		b.frames(1);
		const x0 = b.body(fishAt.id).x;
		b.io.held.add('ability1');
		b.frames(1);
		const hit = b.signals.find((s) => s.name === 'hit');
		check(
			'13. a played character uses an ability on the input map action; the hit carries both instances',
			b.signals.some((s) => s.name === 'ability' && s.payload.button === 'ability1') &&
				hit?.payload.by === bearAt.id &&
				hit?.payload.target === fishAt.id &&
				(hit?.payload.targetInstance as SpawnedInstance)?.id === fishAt.id &&
				hit?.payload.points === 0,
			json(b.signals.map((s) => s.name)),
		);
		b.io.held.clear();
		b.io.held.add('right');
		b.frames(20);
		check('13. a stunned character neither steers nor moves', b.body(fishAt.id).x === x0);
		b.frames(20);
		check('13. …and moves again when the stun ends', b.body(fishAt.id).x > x0);
	}

	// A brain bear uses its abilities whenever a target is in reach; a catch hides and returns.
	{
		const b = bench([bear(true), fish], bodies, [['bear', 'fish']], undefined, {
			abilities: [abilities[1]],
		});
		b.spawn('bearLook', 300, 300);
		const far = b.spawn('fishLook', 600, 300);
		b.frames(5);
		check(
			'13. a brain uses no ability with nobody in reach',
			!b.signals.some((s) => s.name === 'ability'),
		);
		b.loop.effects.moveTo({ instance: far, x: 340, y: 300 });
		b.frames(1);
		const caught = b.signals.find((s) => s.name === 'caught');
		check(
			'13. a brain uses its ability once a target is in reach: a catch, for its points',
			b.signals.some((s) => s.name === 'ability') && caught?.payload.points === 3,
			json(b.signals.map((s) => s.name)),
		);
		check(
			'13. a caught character is culled (hidden) and touches nothing',
			b.loop.culled().has(far.id) && !b.signals.some((s) => s.name === 'collide'),
			json(b.signals.map((s) => s.name)),
		);
		b.frames(30);
		check(
			'13. …and is back where it spawned when the catch ends, safe for a second',
			!b.loop.culled().has(far.id) && b.body(far.id).x === 600,
			json(b.body(far.id)),
		);
		b.loop.effects.moveTo({ instance: far, x: 340, y: 300 });
		b.signals.length = 0;
		b.frames(30);
		const early = b.signals.filter((s) => s.name === 'caught').length;
		b.frames(40);
		check(
			'13. a freed character is not caught again before its grace ends',
			early === 0 && b.signals.filter((s) => s.name === 'caught').length === 1,
			json(b.signals.map((s) => s.name)),
		);
	}

	// Flow's `useAbility`, once, by tag; a bad button is ignored.
	{
		const b = bench([bear(false), fish], bodies, [], undefined, { abilities });
		b.spawn('bearLook', 300, 300);
		b.spawn('fishLook', 350, 300);
		b.frames(1);
		b.loop.effects.useAbility({ tagged: 'bear', button: 'ability3' });
		b.frames(1);
		const before = b.signals.length;
		b.loop.effects.useAbility({ tagged: 'bear', button: 'ability2' });
		b.frames(3);
		const used = b.signals.slice(before).filter((s) => s.name === 'ability');
		check(
			"13. Flow's useAbility uses one once; a bad button does nothing",
			before === 0 && used.length === 1 && used[0].payload.button === 'ability2',
			json(b.signals.map((s) => s.name)),
		);
	}

	// No abilities: no stage, no signal, nothing culled.
	{
		const b = bench([bear(false), fish], bodies);
		b.spawn('bearLook', 300, 300);
		b.spawn('fishLook', 350, 300);
		b.io.held.add('ability1');
		b.frames(10);
		b.loop.effects.useAbility({ tagged: 'bear', button: 'ability1' });
		b.frames(1);
		check(
			'13. a config without abilities raises nothing and culls nothing',
			!b.signals.length && b.loop.culled().size === 0,
		);
	}

	const vocab = ARCADE_VOCAB.actions.find((a) => a.name === 'useAbility');
	check(
		"13. the vocabulary declares useAbility and its buttons (the loop's)",
		!!vocab &&
			json(ARCADE_VOCAB.enums.find((e) => e.name === 'ArcadeAbilityButton')?.values) ===
				json(ABILITY_BUTTONS) &&
			['ability', 'hit', 'caught'].every((n) =>
				ARCADE_VOCAB.events.some(
					(e) => e.name === n && Object.values(ABILITY_SIGNALS).includes(n as never),
				),
			),
	);
}

console.log(`\narcade-characters (loop): ${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
