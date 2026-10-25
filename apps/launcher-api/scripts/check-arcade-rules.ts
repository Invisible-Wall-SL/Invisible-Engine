/**
 * A rules-decided arcade game, played headless end to end (`docs/design/game-families.md` §7.2,
 * P10.8):
 *   pnpm --filter launcher-api check:arcade-rules
 *
 * `motion.js` itself is gated by the root `check:arcade-motion`; this plays the game made of it.
 *
 *  1. THE STARTER GAME STARTS. Game Maker's seed config (`arcade.rules.json`) and starter flow
 *     (`ARCADE_DRIVEN_SEED_DOC`), on `engine-game`'s arcade loop over a real spawn store and the real
 *     Flow interpreter: a tap starts one round (score 0, three lives, one salmon) — one, though the
 *     tap and the loading screen's completion both ask — and its timers
 *     drop bears, hooks and fish from above the field at seeded places.
 *  2. STEERING: the key map's `left` / `right` move the salmon while held; the field's edge holds it.
 *  3. A HAZARD takes a life and is despawned; a PICKUP scores 10 and is despawned; each touch
 *     signals once, not while the bodies stay touching.
 *  4. WHAT FALLS OFF is despawned (`leaveBounds`), so the field never fills to its cap.
 *  5. THE ROUND ENDS at no lives: spawning stops, the round-over screen holds; its tap clears the
 *     field and starts a fresh round.
 *  6. A SEED REPLAYS: the same seed and the same inputs at the same frames give the same bodies and
 *     score; another seed spawns elsewhere.
 *  7. THE LOOP: `collide` only for configured tag pairs, `tagged` aims at every carrier, `setTag`
 *     changes what collides, zones signal entering and leaving, signals are raised after the frame.
 *  8. THE MECHANIC: an arcade rules config is a play field with no RGS session, no spin, no bet and
 *     no wallet, and boots; an RGS arcade config is refused at boot; no other mechanic is a play
 *     field.
 *  9. SLOTS DO NOT RUN IT (source-scanned): `Game.svelte` mounts `<ArcadeStage />` only for a play
 *     field and keeps the reel stack otherwise; the Flow runtime reaches the arcade actions and
 *     values through the family registry, never by importing the arcade module; a slot's engine
 *     read is unchanged.
 * 10. THE SAMPLE IS ONE PIECE: the starter flow validates clean as a rules game over the scene set's
 *     spawn layer; the vocabulary's actions are the loop's effects and its values the loop's; the
 *     scene set, the seed config and the sample components name the same components, layer and
 *     screens; the publish gate still refuses an arcade config.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	ARCADE_DRIVEN_SEED_DOC,
	ARCADE_FIELD_LAYER,
	ARCADE_LOOP_ACTIONS,
	ARCADE_LOOP_VALUES,
	ARCADE_SAMPLE,
	ARCADE_SAMPLE_FIELD,
	ARCADE_SCREENS,
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
	type SpawnedInstance,
} from 'engine-flow-v2';
// The modules themselves: `engine-game`'s entry also exports its Svelte components.
import { ARCADE_VALUES, createArcadeLoop } from 'engine-game/src/game/arcadeLoop';
import {
	ARCADE_RULES_MECHANIC,
	MATCH3_RGS_MECHANIC,
	MATCH3_RULES_MECHANIC,
	mechanicFor,
	REELS_MECHANIC,
	runsIntent,
	WAGER_INTENTS,
} from 'engine-game/src/game/mechanic';
import {
	ARCADE_FIELD,
	ARCADE_SAMPLE_COMPONENTS,
	arcadeReferenceLayout,
	getFullSceneSet,
	listFullSceneSets,
	sceneSpawnLayers,
	spawnLayerSpec,
} from 'engine-layout';
import { normalizeGameConfigDoc, resolveArcade, type GameConfigDoc } from 'game-config';

import { projectSpawnLayers } from '../src/lib/flowV2Projection.ts';
import { unplayableFamilyMessage } from '../src/lib/server/familyGate.ts';

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
const SEED_CONFIG = normalizeGameConfigDoc(
	JSON.parse(read('apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json')),
) as GameConfigDoc;
const EMPTY_LIBRARY = { version: 2 as const, functions: [] };
const LAYOUT = arcadeReferenceLayout();
const FRAME = 1000 / 60;

/** One game: the arcade loop over a real spawn store, the starter flow on the real interpreter. */
const playGame = (seed: string | number, doc: FlowDoc = ARCADE_DRIVEN_SEED_DOC) => {
	const store = createSpawnStore();
	for (const { node, sceneId } of sceneSpawnLayers(LAYOUT.scenes))
		store.declare(spawnLayerSpec(node, sceneId));
	const flowState = createFlowState(doc);
	const mount = createContainerMountModel(
		doc.containers,
		undefined,
		awaitCompleteContainerIds(doc),
	);
	const signals: { name: string; payload: Record<string, unknown> }[] = [];
	const pending: Promise<unknown>[] = [];
	const rules = resolveArcade(SEED_CONFIG);
	const loop = createArcadeLoop({
		rules,
		field: rules.field ?? { w: 1, h: 1 },
		layers: store.layers(),
		live: store,
		seed,
		signal: (name, payload) => {
			signals.push({ name, payload });
			pending.push(runFlowEvent(doc, ctx, name, payload));
		},
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
	/** Let the chains started so far run to their first wait. A chain held on a screen's tap (the
	 *  round-over hold) is left waiting, as in the game. */
	const drain = async () => {
		for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
		pending.length = 0;
	};
	/** One frame: the loop, then the flow's timers and variables, then every chain it started. */
	const frame = async (dt = FRAME) => {
		loop.frame(dt);
		stepFlowState(flowState, dt, (entry) => void pending.push(runFlowStateEntry(doc, ctx, entry)));
		await drain();
	};
	const frames = async (n: number, dt = FRAME) => {
		for (let i = 0; i < n; i++) await frame(dt);
	};
	const key = async (action: string, phase: 'down' | 'up') => {
		pending.push(runFlowStateEntry(doc, ctx, { kind: 'input', action, phase }));
		await drain();
	};
	const live = () => store.live(ARCADE_FIELD_LAYER);
	const of = (componentId: string) => live().filter((i) => i.componentId === componentId);
	const salmon = () => of(ARCADE_SAMPLE.player)[0];
	const body = (id: string) => loop.bodies().find((b) => b.id === id);
	const vars = () => ({
		score: flowState.read('score') as number,
		lives: flowState.read('lives') as number,
		playing: flowState.read('playing') as boolean,
	});
	const event = async (name: string) => {
		pending.push(runFlowEvent(doc, ctx, name, {}));
		await drain();
	};
	/** The tap that starts the game: the round starts on the `startRound` timer, a few frames on. */
	const start = async () => {
		await event('load');
		await event('tapToStart');
		await frames(6);
	};
	/** Drop a body of `componentId` right on the salmon, falling. */
	const dropOnSalmon = async (componentId: string) => {
		const s = salmon();
		const r = store.spawn(ARCADE_FIELD_LAYER, componentId, { x: s.x, y: s.y - 120 });
		if (!r.ok) throw new Error(`spawn refused: ${r.reason}`);
		loop.effects.setVelocity({ instance: r.instance, vx: 0, vy: 600 });
		return r.instance;
	};
	/** Stop every spawner, so a check sees only what it placed. */
	const quiet = async () => {
		for (const timer of ['spawnBear', 'spawnHook', 'spawnFish']) flowState.stopTimer(timer);
		for (const i of live()) if (i.componentId !== ARCADE_SAMPLE.player) store.despawn(i.id);
		await frame();
	};
	return {
		store,
		loop,
		mount,
		flowState,
		signals,
		frame,
		frames,
		key,
		live,
		of,
		salmon,
		body,
		vars,
		start,
		event,
		dropOnSalmon,
		quiet,
		drain,
	};
};

// ── 1. the starter game starts ───────────────────────────────────────────────────────────────
{
	const game = playGame('sample');
	await game.start();
	check(
		'1. a tap starts a round: score 0, three lives, playing',
		JSON.stringify(game.vars()) === JSON.stringify({ score: 0, lives: 3, playing: true }),
		JSON.stringify(game.vars()),
	);
	check(
		'1. …the field and the HUD are shown',
		game.mount.isShown(ARCADE_SCREENS.basegame) && game.mount.isShown(ARCADE_SCREENS.hud),
	);
	check(
		'1. …with one salmon at its start',
		game.of(ARCADE_SAMPLE.player).length === 1 &&
			game.salmon().x === ARCADE_SAMPLE_FIELD.w / 2 &&
			game.salmon().y === 720,
		JSON.stringify(game.live()),
	);
	await game.frames(60 * 4);
	const fallen = [ARCADE_SAMPLE.bear, ARCADE_SAMPLE.hook, ARCADE_SAMPLE.fish].map(
		(c) =>
			game.of(c).length +
			game.signals.filter(
				(s) =>
					(s.payload.instance as SpawnedInstance | undefined)?.componentId === c ||
					(s.payload.b as SpawnedInstance | undefined)?.componentId === c,
			).length,
	);
	check(
		'1. the timers drop bears, hooks and fish',
		fallen.every((n) => n > 0),
		JSON.stringify(fallen),
	);
	const falling = game.live().filter((i) => i.componentId !== ARCADE_SAMPLE.player);
	check(
		"1. …each falling inside the field's width",
		falling.length > 0 &&
			falling.every((i) => {
				const b = game.body(i.id);
				return !!b && b.vy > 0 && b.vx === 0 && i.x >= 0 && i.x < ARCADE_SAMPLE_FIELD.w;
			}),
		JSON.stringify(falling.map((i) => [i.componentId, i.x, game.body(i.id)?.vy])),
	);
	check(
		'1. the live set reads where a body is now, not where it spawned',
		falling.every((i) => i.y > -60),
		JSON.stringify(falling.map((i) => i.y)),
	);
	const tap2 = playGame('sample');
	await tap2.event('load');
	await tap2.event('tapToStart');
	await tap2.event(`complete:${ARCADE_SCREENS.loading}`);
	await tap2.frames(6);
	check(
		'1. the second of tap and loading-complete starts no second round',
		tap2.of(ARCADE_SAMPLE.player).length === 1,
	);
}

// ── 2. steering ──────────────────────────────────────────────────────────────────────────────
{
	const game = playGame('steer');
	await game.start();
	await game.quiet();
	const x0 = game.salmon().x;
	await game.key('left', 'down');
	await game.frames(30);
	const x1 = game.salmon().x;
	check(
		'2. left held moves the salmon left at its speed',
		Math.abs(x0 - 260 - x1) < 1e-6,
		`${x0} → ${x1}`,
	);
	await game.key('left', 'up');
	await game.frames(10);
	check('2. …letting go stops it', game.salmon().x === x1 && game.body(game.salmon().id)?.vx === 0);
	await game.key('right', 'down');
	await game.frames(60 * 4);
	check(
		"2. right held runs it to the field's edge, and the edge holds it",
		game.salmon().x === ARCADE_SAMPLE_FIELD.w - 45,
		String(game.salmon().x),
	);
	await game.key('right', 'up');
}

// ── 3. hazards and pickups ───────────────────────────────────────────────────────────────────
{
	const game = playGame('touch');
	await game.start();
	await game.quiet();
	const bear = await game.dropOnSalmon(ARCADE_SAMPLE.bear);
	await game.frames(20);
	check(
		'3. a bear on the salmon takes a life',
		game.vars().lives === 2,
		JSON.stringify(game.vars()),
	);
	check('3. …and is despawned', !game.store.get(bear.id));
	check(
		'3. …signalled once, with the salmon as a and the hazard as b',
		game.signals.filter((s) => s.name === 'collide').length === 1 &&
			(game.signals[0].payload.a as SpawnedInstance).componentId === ARCADE_SAMPLE.player &&
			game.signals[0].payload.tagB === 'hazard',
		JSON.stringify(game.signals.map((s) => [s.name, s.payload.tagA, s.payload.tagB])),
	);
	const fish = await game.dropOnSalmon(ARCADE_SAMPLE.fish);
	await game.frames(20);
	check(
		'3. a fish scores 10 and is despawned',
		game.vars().score === 10 && !game.store.get(fish.id),
		JSON.stringify(game.vars()),
	);
	check('3. …and costs no life', game.vars().lives === 2);
	// A touch that is not removed signals once, not every step it lasts.
	const loopOnly = playGame('linger', {
		...ARCADE_DRIVEN_SEED_DOC,
		graph: { nodes: [], exec: [], data: [] },
	});
	const s = loopOnly.store.spawn(ARCADE_FIELD_LAYER, ARCADE_SAMPLE.player, { x: 300, y: 300 });
	const h = loopOnly.store.spawn(ARCADE_FIELD_LAYER, ARCADE_SAMPLE.hook, { x: 300, y: 300 });
	await loopOnly.frames(30);
	check(
		'3. a lasting touch signals once',
		s.ok && h.ok && loopOnly.signals.filter((x) => x.name === 'collide').length === 1,
	);
	if (h.ok) loopOnly.loop.effects.moveTo({ instance: h.instance, x: 300, y: 500 });
	await loopOnly.frames(2);
	if (h.ok) loopOnly.loop.effects.moveTo({ instance: h.instance, x: 300, y: 300 });
	await loopOnly.frames(2);
	check(
		'3. …and again once they part and touch again',
		loopOnly.signals.filter((x) => x.name === 'collide').length === 2,
	);
}

// ── 4. what falls off ─────────────────────────────────────────────────────────────────────────
{
	const game = playGame('fall');
	await game.start();
	await game.key('left', 'down');
	await game.frames(5);
	await game.key('left', 'up');
	let most = 0;
	for (let i = 0; i < 60 * 20 && game.vars().playing; i++) {
		await game.frame();
		most = Math.max(most, game.live().length);
	}
	const left = game.signals.filter((s) => s.name === 'leaveBounds');
	check(
		'4. a body that falls off the bottom is signalled',
		left.length > 0 && left.every((s) => s.payload.edge === 'bottom'),
		String(left.length),
	);
	check(
		'4. one spawned above the field to fall in has not left it',
		left.every((s) => (s.payload.instance as SpawnedInstance).y > ARCADE_SAMPLE_FIELD.h),
	);
	check(
		'4. …and despawned',
		left.every((s) => !game.store.get((s.payload.instance as SpawnedInstance).id)),
	);
	check('4. the field never fills to its cap', most < ARCADE_FIELD.cap, String(most));
}

// ── 5. the round ends ─────────────────────────────────────────────────────────────────────────
{
	const game = playGame('over');
	await game.start();
	await game.quiet();
	for (let i = 0; i < 3; i++) {
		await game.dropOnSalmon(ARCADE_SAMPLE.hook);
		await game.frames(15);
	}
	check(
		'5. at no lives the round is over',
		JSON.stringify(game.vars()) === JSON.stringify({ score: 0, lives: 0, playing: false }),
		JSON.stringify(game.vars()),
	);
	check('5. …and the round-over screen holds', game.mount.isShown(ARCADE_SCREENS.over));
	const before = game.live().length;
	game.flowState.startTimer('spawnBear', 10, true);
	await game.frames(30);
	check(
		'5. …nothing spawns while it holds (the timers stopped; a stray one is gated)',
		game.live().length === before,
	);
	await game.key('left', 'down');
	await game.frames(10);
	check('5. …and the salmon does not steer', game.body(game.salmon().id)?.vx === 0);
	await game.key('left', 'up');
	const extra = await game.dropOnSalmon(ARCADE_SAMPLE.bear);
	await game.frames(15);
	check('5. …and a touch costs nothing', game.vars().lives === 0 && !!game.store.get(extra.id));
	game.mount.complete(ARCADE_SCREENS.over);
	await game.drain();
	await game.frames(6);
	check(
		'5. its tap clears the field and starts a new round',
		JSON.stringify(game.vars()) === JSON.stringify({ score: 0, lives: 3, playing: true }) &&
			game.live().length === 1 &&
			game.of(ARCADE_SAMPLE.player).length === 1,
		JSON.stringify([game.vars(), game.live().map((i) => i.componentId)]),
	);
	check('5. …and the round-over screen is gone', !game.mount.isShown(ARCADE_SCREENS.over));
}

// ── 6. a seed replays ─────────────────────────────────────────────────────────────────────────
{
	const run = async (seed: string) => {
		const game = playGame(seed);
		await game.start();
		const script: Record<number, ['left' | 'right', 'down' | 'up']> = {
			30: ['left', 'down'],
			90: ['left', 'up'],
			120: ['right', 'down'],
			260: ['right', 'up'],
		};
		for (let f = 0; f < 600; f++) {
			const k = script[f];
			if (k) await game.key(k[0], k[1]);
			await game.frame();
		}
		return JSON.stringify({
			vars: game.vars(),
			bodies: game.loop.bodies(),
			steps: game.loop.steps,
			signals: game.signals.map((s) => [s.name, s.payload.tagB ?? s.payload.edge]),
		});
	};
	const a = await run('replay');
	check('6. the same seed and inputs replay exactly', a === (await run('replay')));
	check('6. another seed plays differently', a !== (await run('other')));
}

// ── 7. the loop ───────────────────────────────────────────────────────────────────────────────
{
	const store = createSpawnStore();
	store.declare({ id: 'f', spawnable: ['p', 'e', 'c', 'n'], cap: 32, placement: 'free' });
	const got: { name: string; payload: Record<string, unknown> }[] = [];
	const loop = createArcadeLoop({
		rules: {
			fixedHz: 60,
			bodies: {
				p: { shape: 'box', w: 20, h: 20, tags: ['player'] },
				e: { shape: 'circle', r: 10, tags: ['enemy'] },
				c: { shape: 'circle', r: 10, tags: ['coin'] },
			},
			pairs: [['player', 'enemy']],
			zones: [{ id: 'pool', x: 100, y: 0, w: 50, h: 50 }],
		},
		field: { w: 400, h: 400 },
		layers: ['f'],
		live: store,
		seed: 1,
		signal: (name, payload) => got.push({ name, payload }),
	});
	const spawn = (c: string, x: number, y: number) => {
		const r = store.spawn('f', c, { x, y });
		if (!r.ok) throw new Error(r.reason);
		return r.instance;
	};
	const p = spawn('p', 50, 50);
	spawn('c', 50, 50);
	const n = spawn('n', 10, 10);
	loop.frame(FRAME);
	check(
		'7. a pair no configured pair names never signals',
		got.length === 0,
		JSON.stringify(got.map((g) => g.name)),
	);
	check(
		'7. a component with no body moves but touches nothing',
		loop.bodies().some((b) => b.id === n.id),
	);
	const e = spawn('e', 50, 50);
	const sizeBefore = got.length;
	loop.frame(FRAME);
	check(
		'7. collide for the configured pair',
		got.length === sizeBefore + 1 &&
			got.at(-1)?.name === 'collide' &&
			(got.at(-1)?.payload.b as SpawnedInstance).id === e.id,
	);
	loop.effects.setTag({ instance: e, tag: 'enemy', on: false });
	loop.effects.moveTo({ instance: e, x: 300, y: 300 });
	loop.frame(FRAME);
	loop.effects.moveTo({ instance: e, x: 50, y: 50 });
	loop.frame(FRAME);
	check(
		'7. setTag takes a tag away, and the pair no longer collides',
		got.filter((g) => g.name === 'collide').length === 1,
	);
	loop.effects.setVelocity({ tagged: 'player', vx: 3000 });
	loop.frame(FRAME);
	check(
		'7. tagged aims at every body carrying the tag',
		loop.bodies().find((b) => b.id === p.id)?.vx === 3000,
	);
	check(
		'7. a body entering a zone signals enterZone, and leaving it leaveZone',
		got.some((g) => g.name === 'enterZone' && g.payload.zone === 'pool'),
		JSON.stringify(got.map((g) => g.name)),
	);
	for (let i = 0; i < 10; i++) loop.frame(FRAME);
	check(
		'7. …leaveZone',
		got.some((g) => g.name === 'leaveZone' && g.payload.zone === 'pool'),
	);
	const tagless = got.filter((g) => g.name === 'collide').length;
	loop.effects.setVelocity({ tagged: 'nobody', vx: 1 });
	loop.effects.setVelocity({ instance: { id: 'f#999' }, vx: 1 });
	check('7. an aim that names nothing changes nothing', tagless === 1);
	let order: string[] = [];
	const ordered = createSpawnStore();
	ordered.declare({ id: 'f', spawnable: ['p', 'e'], cap: 32, placement: 'free' });
	const inStep: boolean[] = [];
	let stepping = false;
	const l2 = createArcadeLoop({
		rules: {
			fixedHz: 60,
			bodies: {
				p: { shape: 'box', w: 20, h: 20, tags: ['player'] },
				e: { shape: 'box', w: 20, h: 20, tags: ['enemy'], edges: 'pass' },
			},
			pairs: [['player', 'enemy']],
			zones: [],
		},
		field: { w: 100, h: 100 },
		layers: ['f'],
		live: ordered,
		seed: 1,
		signal: (name) => {
			order.push(name);
			inStep.push(stepping);
		},
	});
	ordered.spawn('f', 'p', { x: 50, y: 98 });
	const r = ordered.spawn('f', 'e', { x: 50, y: 60 });
	if (r.ok) l2.effects.setVelocity({ instance: r.instance, vy: 3000 });
	stepping = true;
	const ran = l2.frame(FRAME * 3 + 0.01);
	stepping = false;
	check('7. a frame runs every whole step its time holds', ran === 3, String(ran));
	check(
		'7. …and raises its signals in the order they happened',
		JSON.stringify(order) === JSON.stringify(['collide', 'leaveBounds']),
		JSON.stringify(order),
	);
	order = [];
	check(
		"7. the live set holds the bodies' new places after the frame",
		(ordered.live('f').find((i) => i.componentId === 'e')?.y ?? 0) > 100,
	);
	loop.dispose();
	spawn('e', 1, 1);
	check('7. a disposed loop no longer watches the live set', loop.bodies().length === 0);
	check(
		'7. $engine.random is seeded: the same seed reads the same numbers',
		(() => {
			const a = createArcadeLoop({
				rules: { fixedHz: 60, bodies: {}, pairs: [], zones: [] },
				field: { w: 7, h: 9 },
				layers: [],
				live: store,
				seed: 'x',
				signal: () => {},
			});
			const b = createArcadeLoop({
				rules: { fixedHz: 60, bodies: {}, pairs: [], zones: [] },
				field: { w: 7, h: 9 },
				layers: [],
				live: store,
				seed: 'x',
				signal: () => {},
			});
			const ra = [a.value('random'), a.value('random')];
			return (
				JSON.stringify(ra) === JSON.stringify([b.value('random'), b.value('random')]) &&
				ra[0] !== ra[1] &&
				a.value('fieldWidth') === 7 &&
				a.value('fieldHeight') === 9 &&
				a.value('balance') === undefined
			);
		})(),
	);
}

// ── 8. the mechanic ──────────────────────────────────────────────────────────────────────────
{
	const rules = mechanicFor(SEED_CONFIG);
	check(
		'8. an arcade rules config is the arcade play field',
		rules === ARCADE_RULES_MECHANIC && rules.playField && !rules.unplayable,
	);
	check(
		'8. …free play: no RGS session, no spin, no bet, no wallet, no board input',
		!rules.rgsSession &&
			!rules.spins &&
			!rules.bets &&
			!rules.wallet &&
			!rules.boardInput &&
			rules.outcome === 'rules',
	);
	check(
		'8. …and no wager intent runs',
		WAGER_INTENTS.every((i) => !runsIntent(rules, i)),
	);
	const rgs = mechanicFor({ ...SEED_CONFIG, outcome: undefined });
	check('8. an RGS arcade config is refused at boot', !!rgs.unplayable && rgs.playField);
	check(
		'8. no other mechanic is a play field',
		[REELS_MECHANIC, MATCH3_RULES_MECHANIC, MATCH3_RGS_MECHANIC, mechanicFor(null)].every(
			(m) => !m.playField,
		),
	);
}

// ── 9. slots do not run it ────────────────────────────────────────────────────────────────────
{
	const game = read('apps/lines/src/components/Game.svelte');
	const at = game.indexOf('{#if mechanic.playField}');
	check(
		'9. Game.svelte mounts <ArcadeStage /> only for a play field',
		at > 0 &&
			game.indexOf('<ArcadeStage />') > at &&
			game.indexOf('<ArcadeStage />') < game.indexOf('{:else}', at) &&
			game.split('<ArcadeStage />').length === 2,
	);
	check(
		'9. …and keeps the reel stack in its {:else}',
		game.indexOf('<BoardDrive', at) > game.indexOf('{:else}', at),
	);
	const runtime = read('apps/lines/src/game/flowV2Runtime.svelte.ts');
	check(
		'9. the Flow runtime never imports the arcade module',
		!/from '\.\/arcade'/.test(runtime) && !/createArcadeLoop/.test(runtime),
	);
	check(
		'9. …and reads a family value only for a key the lines reader does not answer',
		/engineRead: \(key\) => linesEngineReader\(key\) \?\? boardValue\(key\)/.test(runtime),
	);
	const registry = read('apps/lines/src/game/flowBoardEffects.ts');
	check('9. the family registry covers every arcade action', /ARCADE_LOOP_ACTIONS/.test(registry));
	const arcade = read('apps/lines/src/game/arcade.ts');
	check(
		'9. only <ArcadeStage /> starts the loop',
		/startArcade/.test(read('apps/lines/src/components/ArcadeStage.svelte')) &&
			[game, runtime, registry].every((s) => !/startArcade/.test(s)) &&
			/registerBoardEffects\(loop\.effects\)/.test(arcade),
	);
}

// ── 10. the sample is one piece ───────────────────────────────────────────────────────────────
{
	const defs = Object.fromEntries(ARCADE_SAMPLE_COMPONENTS.map((d) => [d.id, d]));
	const layers = projectSpawnLayers(
		ARCADE_DRIVEN_SEED_DOC.containers,
		LAYOUT.scenes,
		(id) => defs[id],
	);
	const issues = validateFlowDoc(
		ARCADE_DRIVEN_SEED_DOC,
		ARCADE_VOCAB,
		EMPTY_LIBRARY,
		undefined,
		undefined,
		LAYOUT.scenes.map((s) => s.id),
		undefined,
		'rules',
		layers,
	);
	check(
		'10. the starter flow validates clean as a rules game over the scene set',
		issues.length === 0,
		JSON.stringify(issues.map((i) => `${i.code}@${i.node ?? ''}`)),
	);
	const issuesRgs = validateFlowDoc(
		ARCADE_DRIVEN_SEED_DOC,
		ARCADE_VOCAB,
		EMPTY_LIBRARY,
		undefined,
		undefined,
		LAYOUT.scenes.map((s) => s.id),
		undefined,
		'rules',
		undefined,
	);
	check(
		'10. …and with no layout known',
		issuesRgs.every((i) => i.severity !== 'error'),
		JSON.stringify(issuesRgs.map((i) => i.code)),
	);
	const vocabActions = ARCADE_VOCAB.actions
		.map((a) => a.name)
		.filter((n) => ARCADE_LOOP_ACTIONS.includes(n));
	const loop = createArcadeLoop({
		rules: resolveArcade(SEED_CONFIG),
		field: { w: 1, h: 1 },
		layers: [],
		live: createSpawnStore(),
		seed: 1,
		signal: () => {},
	});
	check(
		"10. the vocabulary's arcade actions are exactly the loop's effects",
		JSON.stringify([...vocabActions].sort()) === JSON.stringify(Object.keys(loop.effects).sort()),
	);
	check(
		"10. …and its values the loop's",
		JSON.stringify(ARCADE_VOCAB.values.map((v) => v.name).sort()) ===
			JSON.stringify(Object.values(ARCADE_VALUES).sort()) &&
			JSON.stringify([...ARCADE_LOOP_VALUES].sort()) ===
				JSON.stringify(Object.values(ARCADE_VALUES).sort()),
	);
	check(
		'10. …and it declares no reel, spin, bet or payline surface',
		![...ARCADE_VOCAB.events, ...ARCADE_VOCAB.actions].some((d) =>
			/reel|spin|bet|payline|win/i.test(d.name),
		),
	);
	const layer = sceneSpawnLayers(LAYOUT.scenes);
	const sample = Object.values(ARCADE_SAMPLE).sort();
	check(
		'10. the scene set has the one field layer, on basegame',
		layer.length === 1 &&
			layer[0].node.id === ARCADE_FIELD_LAYER &&
			layer[0].sceneId === ARCADE_SCREENS.basegame,
	);
	check(
		"10. …listing exactly the sample's components",
		JSON.stringify([...layer[0].node.spawnable].sort()) === JSON.stringify(sample),
	);
	check(
		'10. the sample components are those components',
		JSON.stringify(Object.keys(defs).sort()) === JSON.stringify(sample),
	);
	check(
		"10. the seed config gives each a body, and pairs the flow's tags",
		JSON.stringify(Object.keys(SEED_CONFIG.arcade?.bodies ?? {}).sort()) ===
			JSON.stringify(sample) &&
			JSON.stringify(SEED_CONFIG.arcade?.pairs) ===
				JSON.stringify([
					['player', 'hazard'],
					['player', 'pickup'],
				]),
	);
	check(
		"10. the seed field is the sample's",
		JSON.stringify(SEED_CONFIG.arcade?.field) === JSON.stringify(ARCADE_SAMPLE_FIELD),
	);
	check(
		'10. the scene set has every screen the flow shows',
		Object.values(ARCADE_SCREENS).every((id) => LAYOUT.scenes.some((s) => s.id === id)),
	);
	check(
		'10. arcade is a full scene set (what offers it in Game Maker)',
		listFullSceneSets().some((s) => s.gameType === 'arcade') && !!getFullSceneSet('arcade'),
	);
	check(
		'10. the publish gate still refuses an arcade config',
		/free-play arcade/.test(unplayableFamilyMessage(SEED_CONFIG) ?? ''),
	);
	check(
		'10. the seed config is a free-play arcade game the validator passes',
		SEED_CONFIG.family === 'arcade' && SEED_CONFIG.outcome === 'rules',
	);
}

console.log(`\narcade-rules: ${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
