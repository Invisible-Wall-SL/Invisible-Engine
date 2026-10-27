/**
 * Gravity, jumps and levels in the game (`docs/design/game-families.md` §4.4, §7.2, P10.13):
 *   pnpm --filter launcher-api check:arcade-platformer
 *
 * The mechanics (`jumps.js`, `stepPlatform`, tiles) are gated by the root `check:arcade-platformer`;
 * this plays the loop, the tilemap node and the sample made of them.
 *
 *  1. PARITY: a top-down character with no gravity and no jump on a level with no tiles steps with
 *     P10.11's solid step (the same numbers as a loop built before P10.13 would reach); the sample
 *     configs of P10.8, P10.11 and P10.12 normalize byte for byte as before (no new key appears).
 *  2. THE CONFIG: gravity / maxFall, the jump (sparse, its defaults dropped, a jump with no height
 *     or time dropped), `flap`, the `ground` and `oneWay` body flags round-trip; the validator
 *     refuses a hop on a side view and a gravity jump on a top-down character, and warns a flap with
 *     no gravity and a tap height above the jump.
 *  3. THE LOOP: a `sideScroll` character with a gravity jump stands on the level's tiles, runs, jumps
 *     to its height on the `jump` action (and on `up`, and on a pointer pressed above it), lands on a
 *     one-way ledge from above and passes up through it; a wall tile stops it (onWall); the look's
 *     `grounded` / `onWall` / `airborne` inputs follow; a falling brain character keeps its `vy`;
 *     a flap kicks; a `topDown` hop lifts off, passes over a `ground` body without `collide` and
 *     touches it once it lands; the lifts are published only for hopping characters.
 *  4. THE TILEMAP NODE: `sceneTilemaps` reads a screen's top-level tilemaps (placed, scaled, only
 *     those with a colliding tile), `tilemapCells` / `tilemapRegions`, the save keeps a tilemap and
 *     drops a broken one; `LAYOUT_NODE_KINDS` knows it.
 *  5. THE SAMPLE, played headless on the real interpreter and loop: the hero starts on the ground,
 *     runs right, jumps the first gap, collects a coin, falls into the second gap's pit (a life, back
 *     at the start, the camera snapped), and the same seed and keys replay.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	ARCADE_FIELD_LAYER,
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
import { createArcadeLoop, type ArcadeRules } from 'engine-game/src/game/arcadeLoop';
import {
	LAYOUT_NODE_KINDS,
	TILE_EMPTY,
	normalizeTilemapNode,
	sceneCamera,
	sceneSpawnLayers,
	sceneTilemaps,
	sceneWorld,
	spawnLayerSpec,
	tilemapCells,
	tilemapRegions,
	worldCameraScene,
	type Scene,
	type TilemapNode,
} from 'engine-layout';
import { TILE_ONE_WAY, TILE_SOLID, jumpProfile, type TileGrid } from 'engine-mechanics';
import {
	normalizeGameConfigDoc,
	resolveArcade,
	validateGameConfigDoc,
	type ArcadeBody,
	type ArcadeCharacter,
	type GameConfigDoc,
} from 'game-config';

import {
	ARCADE_LEDGES,
	ARCADE_LEDGES_MAP,
	ARCADE_LEDGES_TILES,
	ARCADE_LEDGES_WORLD,
	arcadeLedgesReferenceLayout,
} from '../../../packages/engine-layout/src/lib/referenceLayouts/arcadeLedges.ts';
import {
	ARCADE_LEDGES_SEED_DOC,
	LEDGES_PLACES,
	LEDGES_START_LIVES,
	LEDGES_VARIABLES,
} from '../../../packages/engine-flow-v2/src/reference/arcadeLedgesSeed.ts';

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
const VIEW = { w: 1422, h: 800 };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const json = (v: unknown) => JSON.stringify(v);

/** A grid of `size` px tiles from (0, 0); `set` maps `"c,r"` to a solidity code. */
const grid = (cols: number, rows: number, size: number, set: Record<string, number>): TileGrid => {
	const cells = new Uint8Array(cols * rows);
	for (const [key, code] of Object.entries(set)) {
		const [c, r] = key.split(',').map(Number);
		cells[r * cols + c] = code;
	}
	return { x: 0, y: 0, tileW: size, tileH: size, cols, rows, cells };
};

/** A loop over a real spawn store with one free layer and the given tiles. */
const bench = (
	characters: ArcadeCharacter[],
	bodies: Record<string, ArcadeBody>,
	opts: { tiles?: TileGrid[]; pairs?: [string, string][]; field?: { w: number; h: number } } = {},
) => {
	const store = createSpawnStore();
	store.declare({ id: 'f', spawnable: Object.keys(bodies), placement: 'free', cap: 200 });
	const held = new Set<string>();
	let pointer: { x: number; y: number } | undefined;
	const inputs: { id: string; input: string; value: unknown }[] = [];
	const signals: { name: string; payload: Record<string, unknown> }[] = [];
	const rules: ArcadeRules = {
		fixedHz: 60,
		bodies,
		pairs: opts.pairs ?? [],
		zones: [],
		characters,
	};
	const loop = createArcadeLoop({
		rules,
		field: () => opts.field ?? { w: 2000, h: 800 },
		layers: () => store.layers(),
		live: store,
		seed: 'bench',
		signal: (name, payload) => void signals.push({ name, payload }),
		input: { held: (action) => held.has(action), pointer: () => pointer },
		setInstanceInput: (id, input, value) => void inputs.push({ id, input, value }),
		...(opts.tiles ? { tiles: () => opts.tiles ?? [] } : {}),
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
	return {
		store,
		loop,
		held,
		inputs,
		signals,
		spawn,
		body,
		frames,
		point: (p?: { x: number; y: number }) => (pointer = p),
	};
};

const heroBody: ArcadeBody = { shape: 'box', w: 32, h: 48, tags: ['player'] };
const JUMP = { kind: 'gravity' as const, height: 128, time: 0.4 };
const runner = (extra: Partial<ArcadeCharacter> = {}): ArcadeCharacter => ({
	id: 'hero',
	component: 'hero',
	movement: { gravity: 1600, maxFall: 1200 },
	controller: { kind: 'sideScroll', speed: 300, jump: JUMP },
	animInputs: { ground: 'grounded', wall: 'onWall', air: 'airborne' },
	...extra,
});
/** Ground at row 10 (top 640) of 64 px tiles; one-way ledge at row 8, cols 4–6; a wall at col 12. */
const LEVEL = grid(30, 12, 64, {
	...Object.fromEntries(Array.from({ length: 30 }, (_, c) => [`${c},10`, TILE_SOLID])),
	'4,8': TILE_ONE_WAY,
	'5,8': TILE_ONE_WAY,
	'6,8': TILE_ONE_WAY,
	'12,9': TILE_SOLID,
	'12,8': TILE_SOLID,
});
const GROUND_Y = 640 - 24;

// ── 1. parity ───────────────────────────────────────────────────────────────────────────────
{
	const topDown: ArcadeCharacter = {
		id: 't',
		component: 't',
		movement: { accel: 900 },
		controller: { kind: 'topDown', speed: 240 },
	};
	const walls: Record<string, ArcadeBody> = {
		t: { shape: 'box', w: 30, h: 30, tags: ['player'] },
		w: { shape: 'box', w: 40, h: 300, tags: [], solid: true },
	};
	const a = bench([topDown], walls);
	const b = bench([topDown], walls, { tiles: [] });
	const ids = [a, b].map((game) => {
		game.spawn('w', 600, 400);
		const t = game.spawn('t', 300, 380);
		game.held.add('right');
		game.frames(120);
		return t.id;
	});
	check(
		'1. a top-down character with no gravity, on no tiles, keeps the P10.11 solid step',
		json(a.loop.bodies()) === json(b.loop.bodies()) && near(a.body(ids[0]).x, 600 - 20 - 15),
		json(a.loop.bodies()),
	);
	check(
		'1. its bodies carry no contact and no lift is published',
		a.loop.bodies().every((x) => !('grounded' in x) && !('z' in x)) && a.loop.lifts().size === 0,
	);
	for (const path of [
		'apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json',
		'packages/engine-mechanics/fixtures/arcade-guard.rules.json',
		'packages/engine-mechanics/fixtures/arcade-river.rules.json',
	]) {
		const doc = normalizeGameConfigDoc(JSON.parse(read(path)));
		const again = normalizeGameConfigDoc(JSON.parse(json(doc)));
		check(
			`1. ${path.split('/').at(-1)} normalizes stably with no P10.13 key`,
			json(doc) === json(again) &&
				!/"gravity"|"maxFall"|"jump"|"ground"|"oneWay"|"flap"/.test(json(doc)),
		);
	}
}

// ── 2. the config ───────────────────────────────────────────────────────────────────────────
{
	const doc = normalizeGameConfigDoc({
		family: 'arcade',
		outcome: 'rules',
		arcade: {
			bodies: {
				hero: { shape: 'box', w: 10, h: 10 },
				log: { shape: 'box', w: 10, h: 10, ground: true, solid: true, oneWay: true },
				ledge: { shape: 'box', w: 10, h: 2, oneWay: true },
			},
			characters: [
				{
					id: 'a',
					component: 'hero',
					movement: { gravity: 2000, maxFall: 900, accel: -1 },
					controller: {
						kind: 'sideScroll',
						speed: 200,
						jump: {
							kind: 'gravity',
							height: 100,
							time: 0.3,
							minHeight: 30,
							coyoteMs: 80,
							airControl: 1,
							nonsense: true,
						},
					},
				},
				{
					id: 'b',
					component: 'b',
					controller: {
						kind: 'sideScroll',
						speed: 1,
						jump: { kind: 'gravity', height: 0, time: 1 },
					},
				},
				{ id: 'c', component: 'c', controller: { kind: 'flap', kick: 400, speed: 120 } },
				{ id: 'd', component: 'd', controller: { kind: 'flap', kick: 0 } },
				{
					id: 'e',
					component: 'e',
					controller: { kind: 'topDown', speed: 1, jump: { kind: 'hop', height: 40, time: 0.25 } },
				},
			],
		},
	} as unknown as GameConfigDoc);
	const [a, b, c, d, e] = doc.arcade?.characters ?? [];
	check(
		'2. gravity / maxFall and the jump round-trip, its unknowns and defaults dropped',
		json(a?.movement) === json({ gravity: 2000, maxFall: 900 }) &&
			json(a?.controller) ===
				json({
					kind: 'sideScroll',
					speed: 200,
					jump: { kind: 'gravity', height: 100, time: 0.3, minHeight: 30, coyoteMs: 80 },
				}),
		json([a?.movement, a?.controller]),
	);
	check(
		'2. a jump with no height is dropped (the controller stays)',
		json(b?.controller) === json({ kind: 'sideScroll', speed: 1 }),
	);
	check(
		'2. a flap keeps its kick and speed; one with no kick is no controller',
		json(c?.controller) === json({ kind: 'flap', kick: 400, speed: 120 }) && !d?.controller,
	);
	check(
		'2. a hop on a top-down character is kept',
		e?.controller?.kind === 'topDown' &&
			'jump' in e.controller &&
			e.controller.jump?.kind === 'hop',
	);
	check(
		'2. the ground and one-way body flags round-trip; a solid body drops its oneWay',
		json(doc.arcade?.bodies?.log) ===
			json({ shape: 'box', w: 10, h: 10, solid: true, ground: true }) &&
			json(doc.arcade?.bodies?.ledge) === json({ shape: 'box', w: 10, h: 2, oneWay: true }),
		json(doc.arcade?.bodies),
	);
	const issues = (characters: unknown[]) =>
		validateGameConfigDoc(
			normalizeGameConfigDoc({
				family: 'arcade',
				outcome: 'rules',
				arcade: { bodies: { x: { shape: 'box', w: 1, h: 1 } }, characters },
			} as unknown as GameConfigDoc),
		).filter((i) => i.path.startsWith('arcade.characters'));
	const wrongKind = issues([
		{
			id: 'p',
			component: 'x',
			controller: { kind: 'sideScroll', speed: 1, jump: { kind: 'hop', height: 10, time: 1 } },
		},
	]);
	const wrongHop = issues([
		{
			id: 'p',
			component: 'x',
			controller: { kind: 'topDown', speed: 1, jump: { kind: 'gravity', height: 10, time: 1 } },
		},
	]);
	check(
		'2. a hop on a side view and a gravity jump on a top-down character are errors',
		wrongKind.some((i) => i.severity === 'error' && i.path.endsWith('jump.kind')) &&
			wrongHop.some((i) => i.severity === 'error' && i.path.endsWith('jump.kind')),
	);
	const flapNoGravity = issues([
		{ id: 'p', component: 'x', controller: { kind: 'flap', kick: 300 } },
	]);
	const tapAbove = issues([
		{
			id: 'p',
			component: 'x',
			controller: {
				kind: 'sideScroll',
				speed: 1,
				jump: { kind: 'gravity', height: 10, time: 1, minHeight: 20 },
			},
		},
	]);
	check(
		'2. a flap with no gravity and a tap above the jump are warnings',
		flapNoGravity.some((i) => i.severity === 'warning' && i.path.endsWith('movement.gravity')) &&
			tapAbove.some((i) => i.severity === 'warning' && i.path.endsWith('minHeight')),
	);
	check(
		'2. a well-formed jumper validates clean',
		issues([
			{
				id: 'p',
				component: 'x',
				movement: { gravity: 1000 },
				controller: { kind: 'sideScroll', speed: 1, jump: JUMP },
			},
		]).length === 0,
	);
}

// ── 3. the loop ─────────────────────────────────────────────────────────────────────────────
{
	const game = bench([runner()], { hero: heroBody }, { tiles: [LEVEL] });
	const hero = game.spawn('hero', 96, 560);
	game.frames(40);
	check(
		'3. a falling character lands on the tiles and stands (grounded)',
		near(game.body(hero.id).y, GROUND_Y) && game.body(hero.id).grounded === true,
		json(game.body(hero.id)),
	);
	game.held.add('jump');
	let top = Infinity;
	for (let i = 0; i < 40; i++) {
		game.frames(1);
		top = Math.min(top, game.body(hero.id).y);
	}
	game.held.delete('jump');
	check(
		'3. the jump action jumps to its height',
		near(GROUND_Y - top, JUMP.height, 0.5),
		`${GROUND_Y - top}`,
	);
	game.frames(40);
	check('3. and it lands again', near(game.body(hero.id).y, GROUND_Y));
	const looks = (input: string) => game.inputs.filter((i) => i.input === input).map((i) => i.value);
	check(
		'3. the look follows: grounded false (spawned in the air) → true → false → true, airborne the reverse, only on change',
		json(looks('ground')) === json([false, true, false, true]) &&
			json(looks('air')) === json([true, false, true, false]),
		json([looks('ground'), looks('air')]),
	);
	game.held.add('up');
	game.frames(2);
	game.held.delete('up');
	check('3. `up` jumps a side view too', game.body(hero.id).vy < 0);
	game.frames(80);
	game.point({ x: 96, y: 300 });
	game.frames(2);
	game.point(undefined);
	check('3. a pointer pressed above the hero jumps', game.body(hero.id).vy < 0);
	game.frames(80);

	game.held.add('right');
	let wall = false;
	for (let i = 0; i < 180 && !wall; i++) {
		game.frames(1);
		wall = game.body(hero.id).onWall === true;
	}
	check(
		'3. a wall tile stops a runner (onWall) at its face',
		wall && near(game.body(hero.id).x, 12 * 64 - 16, 1e-6),
		json(game.body(hero.id)),
	);
	game.held.delete('right');
	game.frames(30);
	check('3. onWall is written to the look', looks('wall').includes(true));
}
{
	const high = runner({
		controller: { kind: 'sideScroll', speed: 300, jump: { ...JUMP, height: 170 } },
	});
	const game = bench([high], { hero: heroBody }, { tiles: [LEVEL] });
	const hero = game.spawn('hero', 5 * 64 + 32, GROUND_Y);
	game.frames(5);
	game.held.add('jump');
	game.frames(60);
	check(
		'3. from below, a jump passes up through a one-way ledge and lands on it',
		near(game.body(hero.id).y, 8 * 64 - 24) && game.body(hero.id).grounded === true,
		json(game.body(hero.id)),
	);
}
{
	const walker: ArcadeCharacter = {
		id: 'goomba',
		component: 'goomba',
		movement: { gravity: 2000 },
		brain: {
			initial: 'go',
			states: [{ id: 'go', behaviour: 'patrol', params: { dx: 300, dy: 0, speed: 80 } }],
			transitions: [],
		},
	};
	const game = bench(
		[walker],
		{ goomba: { shape: 'box', w: 30, h: 30, tags: [] } },
		{ tiles: [LEVEL] },
	);
	const g = game.spawn('goomba', 900, 200);
	game.frames(90);
	check(
		'3. a falling brain character falls and stands, its brain steering only across',
		near(game.body(g.id).y, 640 - 15) && game.body(g.id).x > 900,
		json(game.body(g.id)),
	);
}
{
	const bird: ArcadeCharacter = {
		id: 'bird',
		component: 'bird',
		movement: { gravity: 1500, maxFall: 700 },
		controller: { kind: 'flap', kick: 450 },
	};
	const game = bench([bird], { bird: { shape: 'box', w: 20, h: 20, tags: [] } });
	const b = game.spawn('bird', 200, 300);
	game.frames(20);
	const falling = game.body(b.id).vy;
	game.held.add('jump');
	game.frames(1);
	const kicked = game.body(b.id).vy;
	game.frames(10);
	check(
		'3. a flap falls under its gravity and kicks up on a press, once while held',
		falling > 0 && near(kicked, -450 + 1500 / 60) && game.body(b.id).vy > kicked,
		json([falling, kicked, game.body(b.id).vy]),
	);
}
{
	const hopper: ArcadeCharacter = {
		id: 'salmon',
		component: 'salmon',
		controller: { kind: 'topDown', speed: 300, jump: { kind: 'hop', height: 40, time: 0.25 } },
		animInputs: { lift: 'height', up: 'airborne' },
	};
	const bodies: Record<string, ArcadeBody> = {
		salmon: { shape: 'box', w: 30, h: 20, tags: ['player'] },
		rock: { shape: 'box', w: 40, h: 40, tags: ['rock'], solid: true, ground: true },
		wall: { shape: 'box', w: 40, h: 200, tags: ['wall'], solid: true },
	};
	const game = bench([hopper], bodies, { pairs: [['player', 'rock']] });
	const s = game.spawn('salmon', 100, 300);
	game.spawn('rock', 160, 300);
	game.spawn('wall', 400, 300);
	game.frames(2);
	check(
		'3. a hopping character publishes its lift (0 on the ground)',
		game.loop.lifts().get(s.id) === 0,
	);
	game.held.add('right');
	game.frames(10);
	check(
		'3. on the ground a ground-level solid stops it',
		near(game.body(s.id).x, 160 - 20 - 15) && game.signals.some((x) => x.name === 'collide'),
		json(game.body(s.id)),
	);
	game.signals.length = 0;
	game.held.delete('right');
	game.frames(2);
	game.spawn('rock', 200, 300);
	const [first] = game.store.live('f').filter((i) => i.componentId === 'rock');
	game.store.despawn(first.id);
	game.frames(2);
	game.held.add('jump');
	game.held.add('right');
	let peak = 0;
	let overRock = false;
	for (let i = 0; i < 40; i++) {
		game.frames(1);
		const z = game.loop.lifts().get(s.id) ?? 0;
		peak = Math.max(peak, z);
		if (z > 0 && Math.abs(game.body(s.id).x - 200) < 20) overRock = true;
	}
	check('3. a hop tops out at its height', near(peak, 40, 0.5), `${peak}`);
	check(
		'3. in the air it passes over the ground-level rock without a collide',
		overRock && !game.signals.some((x) => x.name === 'collide'),
	);
	game.held.delete('jump');
	game.frames(60);
	check(
		'3. a tall wall stops it even in the air; back on the ground it is at z 0',
		game.body(s.id).x <= 400 - 20 - 15 + 1e-6 && game.loop.lifts().get(s.id) === 0,
		json(game.body(s.id)),
	);
	check(
		'3. its look gets `height` and `airborne`',
		game.inputs.some((i) => i.input === 'lift' && (i.value as number) > 30) &&
			game.inputs.some((i) => i.input === 'up' && i.value === true),
	);
}

// ── 4. the tilemap node ─────────────────────────────────────────────────────────────────────
{
	check(
		'4. LAYOUT_NODE_KINDS lists tilemap',
		(LAYOUT_NODE_KINDS as readonly string[]).includes('tilemap'),
	);
	const node: TilemapNode = {
		id: 'lv',
		kind: 'tilemap',
		x: 100,
		y: 50,
		scale: { x: 2, y: 2 },
		tileWidth: 32,
		tileHeight: 16,
		cols: 3,
		rows: 2,
		tiles: [0, 1, -1, 2, 0, -1],
		tileset: [
			{ region: 'atlas.json::ground', collide: 'solid' },
			{ region: 'ledge', collide: 'oneWay' },
			{ region: 'decor' },
			{ region: 'unused', collide: 'solid' },
		],
	};
	const scene = {
		id: 's',
		nodes: [node, { ...node, id: 'decor', tiles: [2, 2, 2, 2, 2, 2] }],
	} as unknown as Scene;
	const grids = sceneTilemaps(scene);
	check(
		'4. sceneTilemaps reads a placed, scaled tilemap and skips one that never collides',
		grids.length === 1 &&
			json({ ...grids[0], cells: [...grids[0].cells] }) ===
				json({
					id: 'lv',
					x: 100,
					y: 50,
					tileW: 64,
					tileH: 32,
					cols: 3,
					rows: 2,
					cells: [1, 2, 0, 0, 1, 0],
				}),
		json(grids),
	);
	check(
		'4. tilemapRegions lists the regions a painted tile uses (never an unused entry)',
		json(tilemapRegions(node)) === json(['atlas.json::ground', 'ledge', 'decor']),
	);
	check('4. tilemapCells', json([...tilemapCells(node)]) === json([1, 2, 0, 0, 1, 0]));
	const fixed = normalizeTilemapNode({ ...node, tiles: [0, 9, 'x', 1] } as unknown as Record<
		string,
		unknown
	>);
	check(
		'4. the save fixes tiles to the grid (bad indices empty) and keeps an already-normal node as is',
		json(fixed?.tiles) === json([0, TILE_EMPTY, TILE_EMPTY, 1, TILE_EMPTY, TILE_EMPTY]) &&
			json(normalizeTilemapNode(node as unknown as Record<string, unknown>)) === json(node),
	);
	check(
		'4. a tilemap with no tile size or grid is dropped',
		normalizeTilemapNode({ ...node, cols: 0 } as unknown as Record<string, unknown>) ===
			undefined &&
			normalizeTilemapNode({ ...node, tileWidth: -1 } as unknown as Record<string, unknown>) ===
				undefined,
	);
	const storage = read('apps/launcher-api/src/lib/server/editorStorage.ts');
	check(
		'4. the editor save normalizes a tilemap',
		/kind === 'tilemap'\) return normalizeTilemapNode\(input\) \?\? null/.test(storage),
	);
	const art = read('apps/launcher-api/src/lib/server/editorArtExport.ts');
	check(
		'4. the art export walks a tilemap’s tileset regions (rule 8; check:art-scope ships them)',
		/node\.kind === 'tilemap'\)[\s\S]{0,80}tilemapRegions\(node\)[\s\S]{0,40}addImageRef/.test(art),
	);
}

// ── 5. the sample ───────────────────────────────────────────────────────────────────────────
const LEDGES_CONFIG = normalizeGameConfigDoc(
	JSON.parse(read('packages/engine-mechanics/fixtures/arcade-ledges.rules.json')),
) as GameConfigDoc;
const LEDGES_LAYOUT = arcadeLedgesReferenceLayout();

const playLedges = (seed: string) => {
	const store = createSpawnStore();
	for (const { node, sceneId } of sceneSpawnLayers(LEDGES_LAYOUT.scenes))
		store.declare(spawnLayerSpec(node, sceneId));
	const doc: FlowDoc = ARCADE_LEDGES_SEED_DOC;
	const flowState = createFlowState(doc);
	const mount = createContainerMountModel(
		doc.containers,
		undefined,
		awaitCompleteContainerIds(doc),
	);
	const signals: { name: string; payload: Record<string, unknown> }[] = [];
	const pending: Promise<unknown>[] = [];
	const held = new Set<string>();
	const rules = resolveArcade(LEDGES_CONFIG);
	const cameraScene = worldCameraScene(LEDGES_LAYOUT.scenes);
	const tiles = LEDGES_LAYOUT.scenes.flatMap((scene) => sceneTilemaps(scene));
	const loop = createArcadeLoop({
		rules,
		field: () => rules.field ?? VIEW,
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
		seed,
		signal: (name, payload) => {
			signals.push({ name, payload });
			pending.push(runFlowEvent(doc, ctx, name, payload));
		},
		input: { held: (action) => held.has(action), pointer: () => undefined },
		tiles: () => tiles,
		variable: (id) => flowState.read(id),
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
	const frames = async (n: number) => {
		for (let i = 0; i < n; i++) {
			loop.frame(FRAME);
			stepFlowState(
				flowState,
				FRAME,
				(entry) => void pending.push(runFlowStateEntry(doc, ctx, entry)),
			);
			await drain();
		}
	};
	const key = async (action: string, phase: 'down' | 'up') => {
		if (phase === 'down') held.add(action);
		else held.delete(action);
		pending.push(runFlowStateEntry(doc, ctx, { kind: 'input', action, phase }));
		await drain();
	};
	const start = async () => {
		pending.push(runFlowEvent(doc, ctx, 'load', {}));
		await drain();
		pending.push(runFlowEvent(doc, ctx, 'tapToStart', {}));
		await drain();
		await frames(6);
	};
	const hero = () =>
		store.live(ARCADE_FIELD_LAYER).find((i) => i.componentId === ARCADE_LEDGES.hero);
	const heroBody = () => loop.bodies().find((b) => b.id === hero()?.id);
	return { loop, store, flowState, signals, frames, key, start, hero, heroBody };
};

{
	const issues = validateGameConfigDoc(LEDGES_CONFIG);
	check(
		'5. the sample’s config validates clean',
		!issues.some((i) => i.severity === 'error' || i.path.startsWith('arcade.characters')),
		json(issues),
	);
	check(
		'5. the sample’s flow validates clean as a rules game over its scene set',
		validateFlowDoc(
			ARCADE_LEDGES_SEED_DOC,
			ARCADE_VOCAB,
			EMPTY_LIBRARY,
			undefined,
			undefined,
			LEDGES_LAYOUT.scenes.map((s) => s.id),
			undefined,
			'rules',
		).length === 0,
	);
	check(
		'5. the level is one tilemap of the documented grid, as wide as the world',
		json(LEDGES_CONFIG.arcade?.field) === json(ARCADE_LEDGES_WORLD) &&
			ARCADE_LEDGES_TILES.cols * ARCADE_LEDGES_TILES.size >= ARCADE_LEDGES_WORLD.w,
	);
	const profile = jumpProfile(
		LEDGES_CONFIG.arcade?.characters?.[0]?.controller?.kind === 'sideScroll'
			? (LEDGES_CONFIG.arcade.characters[0].controller.jump ?? { height: 0, time: 0 })
			: { height: 0, time: 0 },
	);
	const wallRise =
		(ARCADE_LEDGES_MAP.groundRow - ARCADE_LEDGES_MAP.wall.rows[0]) * ARCADE_LEDGES_TILES.size;
	check(
		'5. the jump clears the wall and reaches the ledges (rise ≥ two tiles)',
		profile.launch > 0 && 170 > wallRise && wallRise === 128,
		json(profile),
	);

	const run = async (seed: string) => {
		const game = playLedges(seed);
		await game.start();
		const start = game.heroBody();
		await game.frames(30);
		const standing = game.heroBody();
		await game.key('right', 'down');
		// Run to the first gap's lip, then jump it (hold for the full height).
		let jumpedGap = false;
		for (let i = 0; i < 240; i++) {
			await game.frames(1);
			const x = game.heroBody()?.x ?? 0;
			if (!jumpedGap && x > 12 * 64 - 60) {
				await game.key('jump', 'down');
				jumpedGap = true;
			}
			if (jumpedGap && (game.heroBody()?.vy ?? 0) > 0) await game.key('jump', 'up');
			if (x > 15 * 64) break;
		}
		const pastGap = game.heroBody();
		// Keep running into the second gap (no jump): the pit.
		for (let i = 0; i < 400; i++) {
			await game.frames(1);
			if ((game.flowState.read(LEDGES_VARIABLES.lives) as number) < LEDGES_START_LIVES) break;
			if ((game.heroBody()?.x ?? 0) > 18 * 64 && (game.heroBody()?.x ?? 0) < 19 * 64) {
				await game.key('jump', 'down');
				await game.frames(20);
				await game.key('jump', 'up');
			}
		}
		await game.key('right', 'up');
		await game.frames(10);
		return { game, start, standing, pastGap };
	};
	const a = await run('ledges');
	check(
		'5. the hero starts at the start and stands on the ground',
		near(a.start?.x ?? 0, LEDGES_PLACES.hero.x) &&
			near(a.standing?.y ?? 0, 704 - 28) &&
			a.standing?.grounded === true,
		json([a.start, a.standing]),
	);
	check(
		'5. it jumps the first gap and lands past it',
		(a.pastGap?.x ?? 0) > 14 * 64 && (a.pastGap?.y ?? 0) < 704,
		json(a.pastGap),
	);
	check(
		'5. it collects coins on the way',
		(a.game.flowState.read(LEDGES_VARIABLES.coins) as number) >= 1,
		`${a.game.flowState.read(LEDGES_VARIABLES.coins)}`,
	);
	check(
		'5. the second gap’s pit costs a life and puts it back at the start, the camera snapped',
		a.game.flowState.read(LEDGES_VARIABLES.lives) === LEDGES_START_LIVES - 1 &&
			(a.game.heroBody()?.x ?? 0) < 300 &&
			(a.game.loop.camera()?.x ?? 1) === 0,
		json([a.game.flowState.read(LEDGES_VARIABLES.lives), a.game.heroBody(), a.game.loop.camera()]),
	);
	const b = await run('ledges');
	check(
		'5. the same seed and keys replay the same bodies and signals',
		json(a.game.loop.bodies()) === json(b.game.loop.bodies()) &&
			json(a.game.signals.map((s) => s.name)) === json(b.game.signals.map((s) => s.name)),
	);
}

console.log(`\ncheck:arcade-platformer — ${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
