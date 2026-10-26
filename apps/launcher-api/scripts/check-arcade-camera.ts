/**
 * The arcade world and camera (`docs/design/game-families.md` §4.4, §7 `check:arcade-camera`,
 * P10.12):
 *   pnpm --filter launcher-api check:arcade-camera
 *
 *  1. THE CAMERA (`engine-mechanics` `camera.js`): a dead zone the followed body moves in without
 *     moving the camera, and the edge it is pushed by; smoothing as a time constant; the first sight
 *     of a target, and a snap, landing at once; look-ahead; held inside the world (a world narrower
 *     than the view centred; `clampToWorld: false` lets it out); auto-scroll on its axis only,
 *     stopped by the world's end; `moveTo`; a shake bounded by its strength, decaying to rest, a
 *     weaker one ignored; parallax offsets (0 fixed, 1 with the world, ½ half), the game's and the
 *     editor's arithmetic the same.
 *  2. THE LOOP'S CAMERA (`engine-game` `createArcadeLoop`): `enterView` / `leaveView` as edges;
 *     `despawnOutsideView` despawns what has been near the view and is now beyond its margin, keeps
 *     what was spawned ahead inside the margin, never touches a layer without it; the culled set;
 *     the camera actions and values; the same framing at 30 / 60 / 144 fps and on replay, another
 *     seed shaking differently.
 *  3. NO CAMERA, NO CHANGE: a loop given none answers no camera value, backs the camera actions as
 *     no-ops, raises no view signal and moves its bodies exactly as before; the P10.8 scene set
 *     declares no world screen.
 *  4. THE RIVER SAMPLE, played headless on the real interpreter (`ARCADE_RIVER_SEED_DOC` on
 *     `arcadeRiverReferenceLayout()` and `engine-mechanics/fixtures/arcade-river.rules.json`): the camera lands on the salmon
 *     at the river's mouth; swimming up scrolls the view with the salmon inside its dead zone;
 *     spawns appear just above the view; what drifts behind is despawned; a bear shakes the camera
 *     and takes a life; the spawning ground scores a lap and snaps the camera back to the mouth;
 *     the same seed replays the same framing; the flow validates clean.
 *  5. THE DATA: `sceneWorld` / `sceneCamera` keep only whole fields on a `game` screen; the save
 *     keeps them; a spawn layer's margin reaches the live set's spec.
 *  6. PARITY (source-scanned): `<LayoutScene>` adds the world container only on a world screen,
 *     `<SpawnLayer>` culls only under one, the runtime publishes only with a camera, and the river
 *     sample stays off the package entries.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	ARCADE_FIELD_LAYER,
	ARCADE_SAMPLE,
	ARCADE_VOCAB,
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
} from 'engine-flow-v2';
import {
	ARCADE_RIVER_SEED_DOC,
	RIVER_GOAL_ZONE,
	RIVER_LAP_POINTS,
	RIVER_SHAKE,
	RIVER_SPAWN_AHEAD,
	RIVER_START_LIFT,
} from '../../../packages/engine-flow-v2/src/reference/arcadeRiverSeed.ts';
import {
	ARCADE_CULL_MARGIN,
	ARCADE_SIGNALS,
	ARCADE_VALUES,
	createArcadeLoop,
	type ArcadeRules,
} from 'engine-game/src/game/arcadeLoop';
import {
	ARCADE_SAMPLE_COMPONENTS,
	arcadeReferenceLayout,
	hasWorldCamera,
	nodeParallax,
	parallaxShift,
	sceneCamera,
	sceneSpawnLayers,
	sceneWorld,
	spawnLayerSpec,
	worldCameraScene,
	type Scene,
} from 'engine-layout';
import {
	ARCADE_RIVER_CAMERA,
	ARCADE_RIVER_DESPAWN_MARGIN,
	ARCADE_RIVER_PARALLAX,
	ARCADE_RIVER_WORLD,
	arcadeRiverReferenceLayout,
} from '../../../packages/engine-layout/src/lib/referenceLayouts/arcadeRiver.ts';
import {
	createCamera,
	createRng,
	followWith,
	moveCameraTo,
	parallaxOffset,
	shakeCamera,
	stepCamera,
	viewRect,
	type Camera,
} from 'engine-mechanics';
import { normalizeGameConfigDoc, resolveArcade, type GameConfigDoc } from 'game-config';

import { projectSpawnLayers } from '../src/lib/flowV2Projection.ts';
import { normalizeDoc } from '../src/lib/server/editorStorage.ts';

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
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const ROOT = resolve(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const DT = 1 / 60;
const FRAME = 1000 / 60;
const VIEW = { w: 1422, h: 800 };
const still = (x: number, y: number) => ({ x, y, vx: 0, vy: 0 });
const cam = (spec: Parameters<typeof createCamera>[0] = {}, seed = 1): Camera =>
	createCamera(spec, createRng(seed));

// ── 1. the camera ────────────────────────────────────────────────────────────────────────────
{
	const off = cam({ deadZone: { w: 400, h: 300 } });
	stepCamera(off, DT, { view: VIEW, target: still(900, 300) });
	check(
		'1. a snap centres the target, whatever the dead zone',
		off.x === 900 - 711 && off.y === 300 - 400,
		`${off.x},${off.y}`,
	);
	const c = cam({ deadZone: { w: 200, h: 100 } });
	stepCamera(c, DT, { view: VIEW, target: still(711, 400) });
	check(
		'1. the first sight of a target centres it at once',
		c.x === 0 && c.y === 0,
		`${c.x},${c.y}`,
	);
	stepCamera(c, DT, { view: VIEW, target: still(711 + 90, 400 - 45) });
	check('1. a body inside the dead zone moves no camera', c.x === 0 && c.y === 0, `${c.x},${c.y}`);
	stepCamera(c, DT, { view: VIEW, target: still(711 + 150, 400 + 80) });
	check(
		"1. …one past its edge pushes the camera just enough to keep it on the zone's edge",
		near(c.x, 50) && near(c.y, 30),
		`${c.x},${c.y}`,
	);
	const s = cam({ smoothing: 0.25 });
	stepCamera(s, DT, { view: VIEW, target: still(711, 400) });
	stepCamera(s, DT, { view: VIEW, target: still(711 + 100, 400) });
	check(
		'1. smoothing closes 1 − e^(−dt/τ) of the way each step',
		near(s.x, 100 * (1 - Math.exp(-DT / 0.25))),
		String(s.x),
	);
	for (let i = 0; i < 60 * 3; i++) stepCamera(s, DT, { view: VIEW, target: still(811, 400) });
	check('1. …and settles on its aim', near(s.x, 100, 1e-3), String(s.x));
	followWith(s, { tag: 'player' }, true);
	stepCamera(s, DT, { view: VIEW, target: still(2000, 400) });
	check('1. a snap lands at once, then eases again', near(s.x, 2000 - 711) && !s.snapNext);
	const la = cam({ lookAhead: 0.5 });
	stepCamera(la, DT, { view: VIEW, target: { x: 711, y: 400, vx: 200, vy: -100 } });
	check(
		'1. look-ahead leads the body by its velocity × seconds',
		near(la.x, 100) && near(la.y, -50),
	);

	const world = { w: 3000, h: 2000 };
	const cl = cam();
	stepCamera(cl, DT, { view: VIEW, world, target: still(10, 10) });
	check('1. the world holds the view at its top-left', cl.x === 0 && cl.y === 0);
	stepCamera(cl, DT, { view: VIEW, world, target: still(2990, 1990) });
	check(
		'1. …and at its bottom-right',
		cl.x === world.w - VIEW.w && cl.y === world.h - VIEW.h,
		`${cl.x},${cl.y}`,
	);
	const narrow = cam();
	stepCamera(narrow, DT, { view: VIEW, world: { w: 1000, h: 600 }, target: still(900, 0) });
	check(
		'1. a world smaller than the view is centred in it',
		narrow.x === -211 && narrow.y === -100,
	);
	const free = cam({ clampToWorld: false });
	stepCamera(free, DT, { view: VIEW, world, target: still(10, 10) });
	check('1. clampToWorld: false lets the view out', free.x === 10 - 711 && free.y === 10 - 400);

	const run = cam({ autoScroll: { x: 300, y: 0 }, follow: 'player' });
	for (let i = 0; i < 60; i++) stepCamera(run, DT, { view: VIEW, world, target: still(0, 1900) });
	check(
		'1. auto-scroll moves its axis by px/s and the follow keeps only the other',
		near(run.x, 300) && run.y === world.h - VIEW.h,
		`${run.x},${run.y}`,
	);
	for (let i = 0; i < 60 * 10; i++) stepCamera(run, DT, { view: VIEW, world });
	check("1. …and stops at the world's end", run.x === world.w - VIEW.w, String(run.x));

	const mv = cam({ smoothing: 0.1 });
	moveCameraTo(mv, 1500, 900, true);
	stepCamera(mv, DT, { view: VIEW, world });
	check('1. moveTo centres the view on a point (snap)', mv.x === 1500 - 711 && mv.y === 900 - 400);
	check('1. …and stops following', mv.follow === undefined);

	const sh = cam({}, 42);
	shakeCamera(sh, 20, 500);
	const offsets: number[] = [];
	for (let i = 0; i < 40; i++) {
		stepCamera(sh, DT, { view: VIEW });
		offsets.push(Math.max(Math.abs(sh.offsetX), Math.abs(sh.offsetY)));
	}
	check(
		'1. a shake stays within its strength and fades to rest',
		offsets.every((o) => o <= 20) && offsets[0] > 0 && offsets[offsets.length - 1] === 0,
		JSON.stringify(offsets.slice(0, 3)),
	);
	check('1. …and never moves the view itself', sh.x === 0 && sh.y === 0);
	const weak = cam();
	shakeCamera(weak, 20, 500);
	shakeCamera(weak, 5, 2000);
	check('1. a weaker shake does not cut a stronger one short', weak.shake.strength === 20);
	const r1 = cam({}, 7);
	const r2 = cam({}, 7);
	shakeCamera(r1, 10, 300);
	shakeCamera(r2, 10, 300);
	stepCamera(r1, DT, { view: VIEW });
	stepCamera(r2, DT, { view: VIEW });
	check('1. a shake is seeded', r1.offsetX === r2.offsetX && r1.offsetY === r2.offsetY);

	const at = { x: 400, y: 1000 };
	const p0 = parallaxOffset(at, { x: 0, y: 0 });
	const p1 = parallaxOffset(at, { x: 1, y: 1 });
	const ph = parallaxOffset(at, { x: 0.5, y: 0.5 });
	check(
		'1. parallax 0 stays on the screen, 1 moves with the world, ½ at half speed',
		p0.x === 400 && p0.y === 1000 && p1.x === 0 && p1.y === 0 && ph.x === 200 && ph.y === 500,
	);
	check(
		"1. the editor's / LayoutScene's parallaxShift is the camera's arithmetic",
		[
			{ x: 0.3, y: 1.4 },
			{ x: -1, y: 0 },
			{ x: 0.5, y: 0.5 },
		].every((f) => JSON.stringify(parallaxShift(at, f)) === JSON.stringify(parallaxOffset(at, f))),
	);
	check(
		'1. the view rectangle is the camera at the view size, unshaken',
		JSON.stringify(viewRect(sh, VIEW)) === JSON.stringify({ x0: 0, y0: 0, x1: 1422, y1: 800 }),
	);
}

// ── 2. the loop's camera ─────────────────────────────────────────────────────────────────────
const RULES: ArcadeRules = {
	fixedHz: 60,
	bodies: {
		p: { shape: 'box', w: 40, h: 40, tags: ['player'] },
		r: { shape: 'box', w: 40, h: 40, tags: ['rock'], edges: 'pass' },
	},
	pairs: [],
	zones: [],
};
const loopWith = (
	seed: string | number,
	opts: { camera?: boolean; margin?: number; spec?: Parameters<typeof createCamera>[0] } = {},
) => {
	const store = createSpawnStore();
	store.declare({
		id: 'f',
		spawnable: ['p', 'r'],
		cap: 64,
		placement: 'free',
		...(opts.margin !== undefined ? { despawnOutsideView: { margin: opts.margin } } : {}),
	});
	store.declare({ id: 'g', spawnable: ['r'], cap: 64, placement: 'free' });
	const signals: { name: string; payload: Record<string, unknown> }[] = [];
	const world = { w: 4000, h: 1000 };
	const loop = createArcadeLoop({
		rules: RULES,
		field: () => world,
		layers: () => store.layers(),
		live: store,
		seed,
		signal: (name, payload) => signals.push({ name, payload }),
		...(opts.camera === false
			? {}
			: { camera: { spec: opts.spec ?? { follow: 'player' }, world, view: () => VIEW } }),
	});
	return { store, loop, signals };
};
const named = (signals: { name: string; payload: Record<string, unknown> }[], name: string) =>
	signals.filter((s) => s.name === name).map((s) => spawnedIdOf(s.payload.instance));
{
	const { store, loop, signals } = loopWith(1, { margin: 100 });
	const p = store.spawn('f', 'p', { x: 300, y: 500 });
	const ahead = store.spawn('f', 'r', { x: VIEW.w + 80, y: 500 });
	const far = store.spawn('f', 'r', { x: 3500, y: 500 });
	const other = store.spawn('g', 'r', { x: 600, y: 500 });
	if (!p.ok || !ahead.ok || !far.ok || !other.ok) throw new Error('spawn refused');
	loop.frame(FRAME);
	check(
		'2. enterView for each body in view on its first step, none for one outside',
		JSON.stringify(named(signals, ARCADE_SIGNALS.enterView)) ===
			JSON.stringify([p.instance.id, other.instance.id]),
		JSON.stringify(named(signals, ARCADE_SIGNALS.enterView)),
	);
	check(
		'2. a body beyond the cull margin is culled; one in view is not',
		loop.culled().has(far.instance.id) &&
			!loop.culled().has(p.instance.id) &&
			!loop.culled().has(ahead.instance.id),
		JSON.stringify([...loop.culled()]),
	);
	signals.length = 0;
	loop.frame(FRAME);
	check('2. …and nothing again while they stay', signals.length === 0, JSON.stringify(signals));
	loop.effects.cameraMoveTo({ x: 2000 + 711, y: 500, snap: true });
	loop.frame(FRAME);
	check(
		'2. leaveView as the camera leaves a body behind',
		named(signals, ARCADE_SIGNALS.leaveView).includes(p.instance.id),
		JSON.stringify(signals.map((s) => s.name)),
	);
	check(
		"2. despawnOutsideView despawns what was near the view and is beyond the margin now (the player too: it is the layer's rule)",
		!store.get(p.instance.id) && !store.get(ahead.instance.id),
	);
	check(
		'2. …keeps one never near the view, and never touches a layer without it',
		!!store.get(far.instance.id) && !!store.get(other.instance.id),
	);
	check(
		'2. cameraX / cameraY / viewWidth / viewHeight read the view',
		loop.value(ARCADE_VALUES.cameraX) === 2000 &&
			loop.value(ARCADE_VALUES.cameraY) === 100 &&
			loop.value(ARCADE_VALUES.viewWidth) === VIEW.w &&
			loop.value(ARCADE_VALUES.viewHeight) === VIEW.h,
		JSON.stringify([loop.value('cameraX'), loop.value('cameraY')]),
	);

	const k = loopWith(2, { margin: 150 });
	const ahead2 = k.store.spawn('f', 'r', { x: 300, y: -100 });
	if (!ahead2.ok) throw new Error('spawn refused');
	k.loop.effects.setVelocity({ instance: ahead2.instance, vy: 300 });
	k.loop.frame(FRAME);
	check('2. one spawned ahead inside the margin is kept', !!k.store.get(ahead2.instance.id));
	for (let i = 0; i < 60 * 4; i++) k.loop.frame(FRAME);
	check(
		'2. …enters the view as it drifts in',
		named(k.signals, ARCADE_SIGNALS.enterView).includes(ahead2.instance.id),
	);
	check(
		'2. …and is despawned once it has drifted past the margin below',
		!k.store.get(ahead2.instance.id) &&
			named(k.signals, ARCADE_SIGNALS.leaveView).includes(ahead2.instance.id),
	);

	const f = loopWith(3, { spec: { smoothing: 0.2 } });
	const a = f.store.spawn('f', 'p', { x: 300, y: 500 });
	const b = f.store.spawn('f', 'r', { x: 3000, y: 500 });
	if (!a.ok || !b.ok) throw new Error('spawn refused');
	f.loop.effects.cameraFollow({ instance: b.instance, snap: true });
	f.loop.frame(FRAME);
	check('2. cameraFollow an instance (snap)', f.loop.camera()?.x === 3000 - 711);
	f.loop.effects.cameraFollow({ tagged: 'player' });
	f.loop.frame(FRAME);
	const eased = f.loop.camera()?.x ?? 0;
	check(
		'2. cameraFollow a tag eases toward it',
		eased < 3000 - 711 && eased > 300 - 711,
		String(eased),
	);
	f.loop.effects.cameraFollow({});
	const stopped = f.loop.camera()?.x;
	f.loop.frame(FRAME);
	check('2. cameraFollow with neither stops following', f.loop.camera()?.x === stopped);
	f.loop.effects.cameraSetAutoScroll({ x: 120 });
	f.loop.frame(1000 / 60);
	check('2. cameraSetAutoScroll scrolls', near((f.loop.camera()?.x ?? 0) - (stopped ?? 0), 2));
	f.loop.effects.cameraShake({ strength: 9, duration: 200 });
	f.loop.frame(FRAME);
	const c = f.loop.camera();
	check(
		'2. cameraShake rattles the drawn view only',
		!!c && (c.shakeX !== 0 || c.shakeY !== 0) && Math.abs(c.shakeX) <= 9,
	);

	/**
	 * The camera at fixed steps of one run — a body steered right and a shake, both from the start —
	 * fed in frames of `fps`, then single steps to land exactly on each mark.
	 */
	const trace = (fps: number, seed: number | string = 'trace') => {
		const t = loopWith(seed, {
			spec: { follow: 'player', deadZone: { w: 200, h: 120 }, smoothing: 0.15, lookAhead: 0.2 },
		});
		const pl = t.store.spawn('f', 'p', { x: 200, y: 500 });
		if (!pl.ok) throw new Error('spawn refused');
		t.loop.effects.setVelocity({ instance: pl.instance, vx: 900, vy: -120 });
		t.loop.effects.cameraShake({ strength: 12, duration: 400 });
		const out: string[] = [];
		for (const mark of [12, 60, 180]) {
			while (t.loop.steps < mark - 5) t.loop.frame(1000 / fps);
			while (t.loop.steps < mark) t.loop.frame(1000 / 60);
			const c = t.loop.camera()!;
			out.push(`${t.loop.steps}:${c.x},${c.y},${c.shakeX},${c.shakeY}`);
		}
		return out;
	};
	const t60 = trace(60);
	const t30 = trace(30);
	const t144 = trace(144);
	check(
		'2. the same framing at 30, 60 and 144 fps',
		JSON.stringify(t60) === JSON.stringify(t30) && JSON.stringify(t60) === JSON.stringify(t144),
		JSON.stringify([t30, t60, t144]),
	);
	check('2. the same framing on replay', JSON.stringify(trace(60)) === JSON.stringify(t60));
	check(
		'2. another seed shakes differently',
		trace(60, 'other')[0] !== t60[0] && trace(60, 'other')[2] === t60[2],
		JSON.stringify([trace(60, 'other'), t60]),
	);
	check(
		'2. the cull margin covers art bigger than its body',
		ARCADE_CULL_MARGIN >= 128,
		String(ARCADE_CULL_MARGIN),
	);
}

// ── 3. no camera, no change ──────────────────────────────────────────────────────────────────
{
	const run = (camera: boolean) => {
		const t = loopWith('parity', { camera, margin: camera ? undefined : 0 });
		const pl = t.store.spawn('f', 'p', { x: 200, y: 500 });
		const rk = t.store.spawn('f', 'r', { x: 900, y: 100 });
		if (!pl.ok || !rk.ok) throw new Error('spawn refused');
		t.loop.effects.setVelocity({ instance: rk.instance, vx: -100, vy: 500 });
		t.loop.effects.setVelocity({ instance: pl.instance, vx: 50 });
		for (let i = 0; i < 120; i++) t.loop.frame(FRAME);
		return t;
	};
	const none = run(false);
	const cam = run(true);
	const sameBodies =
		JSON.stringify(none.loop.bodies()) === JSON.stringify(cam.loop.bodies()) &&
		none.loop.bodies().length === 2;
	check(
		'3. a loop with no camera answers no camera value',
		['cameraX', 'cameraY', 'viewWidth', 'viewHeight'].every(
			(k) => none.loop.value(k) === undefined,
		) && none.loop.camera() === undefined,
	);
	for (const name of ['cameraFollow', 'cameraMoveTo', 'cameraShake', 'cameraSetAutoScroll'])
		none.loop.effects[name]({ tagged: 'player', x: 1, y: 1, strength: 5, duration: 100 });
	none.loop.frame(FRAME);
	check(
		'3. …backs the camera actions as no-ops and raises no view signal or despawn',
		none.loop.camera() === undefined &&
			none.signals.every((s) => s.name !== 'enterView' && s.name !== 'leaveView') &&
			none.store.live('f').length === 2 &&
			none.loop.culled().size === 0,
	);
	check('3. …and moves the bodies exactly as a loop with a camera does', sameBodies);
	check(
		'3. the P10.8 scene set declares no world or camera screen',
		worldCameraScene(arcadeReferenceLayout().scenes) === undefined,
	);
}

// ── 4. the river sample ──────────────────────────────────────────────────────────────────────
const RIVER_CONFIG = normalizeGameConfigDoc(
	JSON.parse(read('packages/engine-mechanics/fixtures/arcade-river.rules.json')),
) as GameConfigDoc;
const RIVER = arcadeRiverReferenceLayout();
const EMPTY_LIBRARY = { version: 2 as const, functions: [] };
const playRiver = (seed: string | number, doc: FlowDoc = ARCADE_RIVER_SEED_DOC) => {
	const store = createSpawnStore();
	for (const { node, sceneId } of sceneSpawnLayers(RIVER.scenes))
		store.declare(spawnLayerSpec(node, sceneId));
	const flowState = createFlowState(doc);
	const mount = createContainerMountModel(
		doc.containers,
		undefined,
		awaitCompleteContainerIds(doc),
	);
	const signals: { name: string; payload: Record<string, unknown> }[] = [];
	const pending: Promise<unknown>[] = [];
	const rules = resolveArcade(RIVER_CONFIG);
	const scene = worldCameraScene(RIVER.scenes);
	const world = sceneWorld(scene);
	const loop = createArcadeLoop({
		rules,
		field: () => rules.field ?? world ?? VIEW,
		layers: () => store.layers(),
		live: store,
		seed,
		signal: (name, payload) => {
			signals.push({ name, payload });
			pending.push(runFlowEvent(doc, ctx, name, payload));
		},
		camera: { spec: sceneCamera(scene), world, view: () => VIEW },
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
	const frame = async (dt = FRAME) => {
		loop.frame(dt);
		stepFlowState(flowState, dt, (entry) => void pending.push(runFlowStateEntry(doc, ctx, entry)));
		await drain();
	};
	const frames = async (n: number) => {
		for (let i = 0; i < n; i++) await frame();
	};
	const key = async (action: string, phase: 'down' | 'up') => {
		pending.push(runFlowStateEntry(doc, ctx, { kind: 'input', action, phase }));
		await drain();
	};
	const event = async (name: string) => {
		pending.push(runFlowEvent(doc, ctx, name, {}));
		await drain();
	};
	const live = () => store.live(ARCADE_FIELD_LAYER);
	const salmon = () => live().find((i) => i.componentId === ARCADE_SAMPLE.player);
	return { store, loop, flowState, signals, frame, frames, key, event, live, salmon };
};
{
	const scene = worldCameraScene(RIVER.scenes);
	check(
		"4. the river's play field is its basegame screen, with the world and camera it declares",
		scene?.id === 'basegame' &&
			JSON.stringify(sceneWorld(scene)) === JSON.stringify(ARCADE_RIVER_WORLD) &&
			sceneCamera(scene)?.follow === ARCADE_RIVER_CAMERA.follow,
	);
	const game = playRiver('river');
	await game.event('load');
	await game.event('tapToStart');
	await game.frames(8);
	const s0 = game.salmon();
	const c0 = game.loop.camera();
	check(
		"4. a round starts with the salmon at the river's mouth",
		!!s0 && s0.x === ARCADE_RIVER_WORLD.w / 2 && s0.y === ARCADE_RIVER_WORLD.h - RIVER_START_LIFT,
		JSON.stringify(s0),
	);
	check(
		'4. …and the camera landed on it, held at the bottom of the world',
		!!c0 && c0.y === ARCADE_RIVER_WORLD.h - VIEW.h && c0.x === 0,
		JSON.stringify(c0),
	);
	await game.key('up', 'down');
	const ys: { salmon: number; cam: number }[] = [];
	for (let i = 0; i < 60 * 3; i++) {
		await game.frame();
		const sa = game.salmon();
		const ca = game.loop.camera();
		if (sa && ca) ys.push({ salmon: sa.y, cam: ca.y });
	}
	await game.key('up', 'up');
	const last = ys[ys.length - 1];
	check(
		'4. swimming up scrolls the view up the river',
		!!last && last.cam < ARCADE_RIVER_WORLD.h - VIEW.h - 600,
		JSON.stringify(last),
	);
	check(
		'4. …with the salmon kept on screen the whole way',
		ys.every((p) => p.salmon - p.cam > 0 && p.salmon - p.cam < VIEW.h),
		JSON.stringify(ys.find((p) => !(p.salmon - p.cam > 0 && p.salmon - p.cam < VIEW.h))),
	);
	const spawned = game.signals.filter((s) => s.name === ARCADE_SIGNALS.enterView);
	check('4. spawns drift into the view from above', spawned.length > 1, String(spawned.length));
	const behind = game
		.live()
		.filter((i) => i.componentId !== ARCADE_SAMPLE.player)
		.filter((i) => i.y > (last?.cam ?? 0) + VIEW.h + ARCADE_RIVER_DESPAWN_MARGIN + 60);
	check(
		'4. what the camera left behind was despawned',
		behind.length === 0,
		JSON.stringify(behind),
	);
	check(
		'4. …and every spawn appeared just above the view',
		game.signals
			.filter((s) => s.name === ARCADE_SIGNALS.enterView)
			.every((s) => {
				const i = s.payload.instance as { componentId: string; y: number };
				return i.componentId === ARCADE_SAMPLE.player || i.y < (last?.cam ?? 0) + VIEW.h + 50;
			}),
	);

	// A bear on the salmon: a life and a shake.
	const sa = game.salmon()!;
	const bear = game.store.spawn(ARCADE_FIELD_LAYER, ARCADE_SAMPLE.bear, { x: sa.x, y: sa.y - 40 });
	if (!bear.ok) throw new Error('spawn refused');
	await game.frame();
	await game.frame();
	const shaken = game.loop.camera();
	check(
		'4. a bear takes a life and shakes the camera',
		game.flowState.read('lives') === 2 &&
			!!shaken &&
			(shaken.shakeX !== 0 || shaken.shakeY !== 0) &&
			Math.abs(shaken.shakeX) <= RIVER_SHAKE.strength,
		JSON.stringify([game.flowState.read('lives'), shaken]),
	);

	// The spawning ground: a lap, back to the mouth, the camera snapped there.
	game.loop.effects.moveTo({ tagged: 'player', y: 400 });
	game.loop.effects.setVelocity({ tagged: 'player', vy: -600 });
	const score0 = game.flowState.read('score') as number;
	let lapped = false;
	for (let i = 0; i < 60 && !lapped; i++) {
		await game.frame();
		lapped = game.signals.some(
			(s) => s.name === ARCADE_SIGNALS.enterZone && s.payload.zone === RIVER_GOAL_ZONE,
		);
	}
	await game.frame();
	game.loop.effects.setVelocity({ tagged: 'player', vy: 0 });
	await game.frame();
	const back = game.salmon();
	const camBack = game.loop.camera();
	check(
		'4. the spawning ground scores a lap',
		lapped && (game.flowState.read('score') as number) >= score0 + RIVER_LAP_POINTS,
		JSON.stringify([lapped, score0, game.flowState.read('score')]),
	);
	check(
		'4. …sends the salmon back to the mouth and the camera with it at once',
		!!back &&
			back.y > ARCADE_RIVER_WORLD.h - RIVER_START_LIFT - 30 &&
			camBack?.y === ARCADE_RIVER_WORLD.h - VIEW.h,
		JSON.stringify([back, camBack]),
	);

	const framing = async (seed: string) => {
		const g = playRiver(seed);
		await g.event('load');
		await g.event('tapToStart');
		await g.frames(8);
		await g.key('up', 'down');
		const out: string[] = [];
		for (let i = 0; i < 60 * 4; i++) {
			await g.frame();
			if (i % 20 === 0) {
				const c = g.loop.camera()!;
				out.push(
					`${c.x.toFixed(6)},${c.y.toFixed(6)}:${g
						.live()
						.map((l) => l.id)
						.join('|')}`,
				);
			}
		}
		return out;
	};
	const a = await framing('replay');
	check(
		'4. the same seed replays the same framing and spawns',
		JSON.stringify(a) === JSON.stringify(await framing('replay')),
	);
	const defs = Object.fromEntries(ARCADE_SAMPLE_COMPONENTS.map((d) => [d.id, d]));
	const issues = validateFlowDoc(
		ARCADE_RIVER_SEED_DOC,
		ARCADE_VOCAB,
		EMPTY_LIBRARY,
		undefined,
		undefined,
		RIVER.scenes.map((sc) => sc.id),
		undefined,
		'rules',
		projectSpawnLayers(ARCADE_RIVER_SEED_DOC.containers, RIVER.scenes, (id) => defs[id]),
	);
	check(
		'4. the river flow validates clean as a rules game over its scene set',
		issues.length === 0,
		JSON.stringify(issues.map((i) => `${i.code}@${i.node ?? ''}`)),
	);
	check(
		'4. it spawns ahead from the camera keys',
		JSON.stringify(ARCADE_RIVER_SEED_DOC).includes('"key":"cameraY"') &&
			RIVER_SPAWN_AHEAD < ARCADE_RIVER_DESPAWN_MARGIN,
	);
	const backdrop = RIVER.scenes
		.find((s) => s.id === 'basegame')
		?.nodes.find((n) => n.id === 'river-backdrop');
	check(
		'4. its backdrop is a parallax layer',
		!!backdrop && JSON.stringify(nodeParallax(backdrop)) === JSON.stringify(ARCADE_RIVER_PARALLAX),
	);
}

// ── 5. the data ──────────────────────────────────────────────────────────────────────────────
{
	const base: Scene = { id: 's', name: 's', nodes: [] };
	check(
		'5. a whole world is read; a broken one is not',
		JSON.stringify(sceneWorld({ ...base, world: { w: 10, h: 20 } })) === '{"w":10,"h":20}' &&
			sceneWorld({ ...base, world: { w: 0, h: 20 } }) === undefined &&
			sceneWorld({ ...base, world: { w: 10 } as never }) === undefined,
	);
	check(
		'5. only a game screen has a world or a camera',
		sceneWorld({ ...base, space: 'canvas', world: { w: 10, h: 20 } }) === undefined &&
			!hasWorldCamera({ ...base, space: 'standard', camera: { follow: 'p' } }),
	);
	check(
		'5. the camera keeps whole fields and drops defaults',
		JSON.stringify(
			sceneCamera({
				...base,
				camera: {
					follow: ' player ',
					deadZone: { w: 10, h: -1 },
					smoothing: 0,
					lookAhead: 0.2,
					clampToWorld: true,
					autoScroll: { x: 0, y: -50 },
				},
			}),
		) ===
			'{"follow":"player","deadZone":{"w":10,"h":0},"lookAhead":0.2,"autoScroll":{"x":0,"y":-50}}',
		JSON.stringify(sceneCamera({ ...base, camera: { follow: ' player ' } })),
	);
	check(
		'5. parallax (1, 1) is no parallax',
		nodeParallax({
			id: 'n',
			kind: 'container',
			x: 0,
			y: 0,
			children: [],
			parallax: { x: 1, y: 1 },
		}) === undefined,
	);
	const saved = normalizeDoc(RIVER, 'arcade-river');
	const savedScene = saved.scenes.find((s) => s.id === 'basegame');
	check(
		"5. the save keeps a screen's world and camera",
		JSON.stringify(savedScene?.world) === JSON.stringify(ARCADE_RIVER_WORLD) &&
			JSON.stringify(savedScene?.camera) === JSON.stringify(sceneCamera(scene4())),
		JSON.stringify([savedScene?.world, savedScene?.camera]),
	);
	const savedField = savedScene?.nodes.find((n) => n.id === ARCADE_FIELD_LAYER);
	check(
		"5. …and a node's parallax and a spawn layer's margin",
		!!savedScene?.nodes.find((n) => n.id === 'river-backdrop')?.parallax &&
			savedField?.kind === 'spawnLayer' &&
			savedField.despawnOutsideView?.margin === ARCADE_RIVER_DESPAWN_MARGIN,
	);
	const spec = sceneSpawnLayers(RIVER.scenes).map(({ node, sceneId }) =>
		spawnLayerSpec(node, sceneId),
	)[0];
	check(
		"5. a spawn layer's margin reaches the live set's spec",
		spec?.despawnOutsideView?.margin === ARCADE_RIVER_DESPAWN_MARGIN,
	);
	check(
		'5. a layer with no margin has none in its spec (P10.8 layers unchanged)',
		sceneSpawnLayers(arcadeReferenceLayout().scenes).every(
			({ node }) => !('despawnOutsideView' in spawnLayerSpec(node)),
		),
	);
}
function scene4(): Scene {
	return worldCameraScene(RIVER.scenes)!;
}

// ── 6. parity, source-scanned ────────────────────────────────────────────────────────────────
{
	const layoutScene = read('packages/engine-layout/src/lib/LayoutScene.svelte');
	check(
		'6. <LayoutScene> adds the world container only on a world screen',
		/const worldCamera = untrack\(\s*\(\) => \(scene\.space \?\? 'game'\) === 'game' && hasWorldCamera\(scene\)/.test(
			layoutScene,
		) &&
			/\{#if worldCamera\}[\s\S]*?\{:else\}\s*\{@render sceneNodes\(\)\}/.test(layoutScene) &&
			/\{:else if worldCamera && nodeParallax\(node\)\}/.test(layoutScene),
	);
	const spawnLayer = read('packages/engine-layout/src/lib/SpawnLayer.svelte');
	check(
		'6. <SpawnLayer> culls only under a world camera',
		/const culling = inWorldCamera\(\);/.test(spawnLayer) &&
			/\{#if culling\}[\s\S]*visible=\{!isCulled\(instance\.id\)\}[\s\S]*\{:else\}\s*<Container x=\{places\[instance\.id\]\?\.x \?\? instance\.x\} y=\{places\[instance\.id\]\?\.y \?\? instance\.y\}>/.test(
				spawnLayer,
			),
	);
	const arcade = read('apps/lines/src/game/arcade.ts');
	check(
		'6. the runtime publishes the camera only when the loop has one',
		/const camera = loop\.camera\(\);\s*if \(!camera\) return;\s*setWorldCameraView\(camera\);\s*setCulled/.test(
			arcade,
		) && /if \(!scene\) return;/.test(arcade),
	);
	check(
		'6. the river sample stays off the package entries',
		!/arcadeRiver/.test(read('packages/engine-flow-v2/index.ts')) &&
			!/arcadeRiver/.test(read('packages/engine-layout/src/lib/index.ts')) &&
			!/arcadeRiver/.test(read('packages/engine-layout/src/lib/referenceLayouts/index.ts')),
	);
	check(
		"6. the vocabulary's camera values are the loop's",
		['cameraX', 'cameraY', 'viewWidth', 'viewHeight'].every((v) =>
			Object.values(ARCADE_VALUES).includes(v as never),
		) && ['enterView', 'leaveView'].every((e) => ARCADE_VOCAB.events.some((d) => d.name === e)),
	);
}

console.log(`\ncheck:arcade-camera — ${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
