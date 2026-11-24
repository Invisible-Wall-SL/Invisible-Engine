// Plays THE SLIDE ON SALMONS' ORIGINAL LEVELS (`arcade.online.slide`, owner 2026-11-24: "so a
// player is not getting stuck. Like on the river borders and on the props with collisions") in a
// headless shell against a real game server on localhost, once with the exported config's slide
// deleted (OFF, how it played before) and once as exported (ON). The level is pinned (`--seed`),
// the page's own player is each class in turn, and real key events are held in the page:
//   - a salmon held diagonally upstream into the left bank and into the right bank;
//   - a salmon pushed into a rock from below its centre, below each corner and from the side;
//   - a bear and a fisherman walking diagonally along the bank limit, and a fisherman along the
//     water's edge;
//   - what nothing may pass: a salmon held upstream at a waterfall's foot without tapping, a
//     fisherman pushed into the water, a bear pushed into a waterfall's block and into the bank
//     limit, and in every case no body inside a solid of its class or off the field.
// A bank case is played where the room's own sim (`createRoomSim`, no browser) says a player
// sticks WITHOUT the slide: the first such place from the sea, clear of whirlpools, sand,
// waterfalls and rocks. The rock is the first with open water round it. The player is put there
// in the in-process room (the server's body is moved; the page takes it as a correction), then
// the keys go down for 3 s of the page's clock. STUCK is under half a cell (24 px) in a second
// while they are held, read from the room.
// PREDICTION AGAINST THE ROOM: over each hold, the predictor's `corrections` and `snaps` (the
// probe's), how far the drawn own player is off the path the room then takes (px; the probe does
// not expose a correction's size), and how far apart the two are once at rest. The open-water
// swim is the baseline.
// The keys are the screen's (`arcade.online.keys: 'screen'`, mirrored isometric): the run prints
// what each of the eight key directions is in the world, as the room moved a bear under them.
// Asserted with the slide ON: no bank or rock case is stuck, no hold snaps, the drawn player is
// no further off the room's path than the baseline allows, and nothing passes what it must not.
// The OFF numbers are printed beside them as the comparison.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/salmons-slide-play.mjs --runtime apps/lines/build --out <dir> \
//     [--chrome <exe>] [--seed 31337]
//
// The runtime must play arcade: build it with `PUBLIC_IE_FAMILIES=arcade pnpm --filter lines build`.
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { clampInput } from '../../packages/engine-mechanics/src/online.js';
import { STATUS } from '../../packages/engine-mechanics/src/onlineRules.js';
import { pointerMove } from '../../packages/engine-mechanics/src/pointerControl.js';
import { salmonsConfig } from '../../packages/engine-mechanics/src/salmons.js';
import { CELL, salmonsMapRiver } from '../../packages/engine-mechanics/src/salmonsMap.js';
import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	sceneProjector,
	screenToWorldDirection,
} from '../../packages/engine-layout/src/lib/projection.ts';
import {
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { worldCameraScene } from '../../packages/engine-layout/src/lib/worldCamera.ts';
import { SALMONS_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import { normalizeGameConfigDoc, onlineGameOf } from '../../packages/game-config/index.ts';
import { createConfigSource } from '../../services/game-server/src/configSource.ts';
import { createRoomSim } from '../../services/game-server/src/roomSim.ts';
import { createGameServer } from '../../services/game-server/src/server.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { matchMaker } = await import(
	pathToFileURL(
		createRequire(join(ROOT, 'services/game-server/package.json')).resolve('@colyseus/core'),
	).href
);
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/salmons-slide-play') },
		chrome: { type: 'string' },
		seed: { type: 'string', default: '31337' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'salmons';
const SEED = Number(opt.seed);
const MODES = ['off', 'on'];
/** The page's clock: 60 frames a second, stepped no faster than the wall clock. */
const FPS = 60;
const HOLD_FRAMES = 3 * FPS;
const STUCK_PX = CELL / 2;

// THE TWO GAMES: the export on one pinned level, nobody else in the room; OFF is the same config
// with its slide deleted, on the server and in the page's snapshot alike.
const river = salmonsMapRiver(SEED);
const authored = salmonsConfig(river);
authored.arcade.online.levels = { seeds: [SEED] };
authored.arcade.online.bots = undefined;
const withoutSlide = structuredClone(authored);
delete withoutSlide.arcade.online.slide;
const configs = { on: normalizeGameConfigDoc(authored), off: normalizeGameConfigDoc(withoutSlide) };
const games = { on: onlineGameOf(configs.on), off: onlineGameOf(configs.off) };
const gameKey = (mode) => `salmons-slide-${mode}`;
const doc = salmonsReferenceLayout(river);
const tickHz = games.on.online.tickHz;

// THE KEYS, as the page turns them (`apps/lines` `online.ts` `screenMoveBy`).
const projector = sceneProjector(worldCameraScene(doc.scenes));
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const VIRTUAL_KEY = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
const KEY_SETS = [
	['ArrowUp'],
	['ArrowUp', 'ArrowRight'],
	['ArrowRight'],
	['ArrowRight', 'ArrowDown'],
	['ArrowDown'],
	['ArrowDown', 'ArrowLeft'],
	['ArrowLeft'],
	['ArrowLeft', 'ArrowUp'],
];
const moveOf = (keys) => {
	const [sx, sy] = keys.reduce(
		([x, y], code) => [x + ARROWS[code][0], y + ARROWS[code][1]],
		[0, 0],
	);
	return pointerMove({ x: 0, y: 0 }, screenToWorldDirection(projector, sx, sy), 0);
};
/** The keys whose move in the world points along `(wx, wy)` (each −1, 0 or 1). */
const keysFor = ([wx, wy]) => {
	const keys = KEY_SETS.find((set) => {
		const { moveX, moveY } = moveOf(set);
		return Math.sign(moveX) === wx && Math.sign(moveY) === wy;
	});
	if (!keys) throw new Error(`no keys move the world's (${wx}, ${wy})`);
	return keys;
};
const named = (keys) => keys.map((code) => code.replace('Arrow', '')).join(' + ');
const UP = [0, -1];

// THE LEVEL, as the room makes it.
const level = createRoomSim(games.on, { seed: SEED }).game;
const zoneById = new Map(level.zones.map((zone) => [zone.id, zone]));
const halfOf = (character) => {
	const body = level.bodies[level.online.characters.find((c) => c.id === character).body];
	return body.shape === 'circle' ? { w: body.r, h: body.r } : { w: body.w / 2, h: body.h / 2 };
};
/** The zones solid from every side for a class (a waterfall's one-way line is not among them). */
const solidsOf = (character) =>
	level.online.rules.zones
		.filter((rule) => rule.solid === true && (rule.characters?.includes(character) ?? true))
		.map((rule) => zoneById.get(rule.zone))
		.filter(Boolean);
const SOLIDS = Object.fromEntries(level.online.characters.map(({ id }) => [id, solidsOf(id)]));
/** How deep a class's body at `at` is inside one of its solids, px (0: in none). */
const depthIn = (character, at) => {
	const half = halfOf(character);
	let depth = 0;
	for (const zone of SOLIDS[character]) {
		const x = Math.min(at.x + half.w, zone.x + zone.w) - Math.max(at.x - half.w, zone.x);
		const y = Math.min(at.y + half.h, zone.y + zone.h) - Math.max(at.y - half.h, zone.y);
		if (x > 0 && y > 0) depth = Math.max(depth, Math.min(x, y));
	}
	return depth;
};
const offField = (character, at) => {
	const half = halfOf(character);
	return (
		at.x < half.w || at.y < half.h || at.x > level.field.w - half.w || at.y > level.field.h - half.h
	);
};
const near = (at, box, margin) =>
	at.x > box.x - margin &&
	at.x < box.x + box.w + margin &&
	at.y > box.y - margin &&
	at.y < box.y + box.h + margin;
const lineOf = (fall) => fall.y + fall.h / 2;
/** Whether a place is where something other than a bank or a rock moves or holds a body. */
const hazard = (at, { rocks = 2 * CELL, falls = 4 * CELL } = {}) =>
	river.whirlpools.some((pool) => Math.hypot(pool.x - at.x, pool.y - at.y) < 5 * CELL) ||
	river.sandbanks.some((sand) => near(at, sand, 2 * CELL)) ||
	river.waterfalls.some((fall) => Math.abs(lineOf(fall) - at.y) < falls) ||
	river.rocks.some((rock) => near(at, rock, rocks)) ||
	at.y > river.sea.y - 8 * CELL ||
	at.y < river.bands[2].y;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** The least a body moved in any second of `points` (`perSecond` of them a second), px. */
const slowestSecond = (points, perSecond) => {
	let least = Infinity;
	for (let i = 0; i + perSecond < points.length; i++)
		least = Math.min(least, dist(points[i], points[i + perSecond]));
	return least;
};

/** Steps the page takes after a placement before the keys go down: a salmon drifts meanwhile. */
const SYNC_STEPS = Math.round(tickHz / 2);
/** The room's sim alone, a new room each time: a class put at `at`, resting, then held along
 *  `world` for 3 s. Its path while held. */
const trial = (mode, character, at, world) => {
	const sim = createRoomSim(games[mode], { seed: SEED });
	const player = sim.join('trial', { character });
	Object.assign(player.body, at);
	let seq = 0;
	const path = [];
	const run = (steps, move) => {
		for (let i = 0; i < steps; i++) {
			const input = clampInput(
				{ seq: ++seq, view: sim.steps, ...move, buttons: 0 },
				sim.game.field,
			);
			sim.step(() => [input]);
			path.push({ x: player.body.x, y: player.body.y });
		}
	};
	run(SYNC_STEPS, { moveX: 0, moveY: 0 });
	path.length = 0;
	run(3 * tickHz, moveOf(keysFor(world)));
	return { path, free: player.status === STATUS.free };
};

/**
 * The first place from the sea where a class held along `world` against a bank's line sticks
 * without the slide (the room's sim), both paths clear of everything but the bank. `edgeOf(i)`:
 * the line's x in band `i`; the body starts 2 px off it on the side `from` (−1: at a lower x).
 * `first`: the band the search starts at, going up the river.
 */
const bankSite = (character, world, edgeOf, from, first = river.bands.length - 7) => {
	const half = halfOf(character);
	for (let i = first; i >= 6; i--) {
		const band = river.bands[i];
		const edge = edgeOf(i);
		if (edge === undefined) continue;
		const at = { x: edge + from * (half.w + 2), y: band.y + band.h / 2 };
		if (hazard(at) || depthIn(character, at) > 0) continue;
		const off = trial('off', character, at, world);
		if (!off.free || slowestSecond(off.path, tickHz) >= STUCK_PX) continue;
		const on = trial('on', character, at, world);
		if (on.free && ![...off.path, ...on.path].some((point) => hazard(point)))
			return { at, band: i };
	}
	throw new Error(`level ${SEED}: no place where a ${character} sticks along (${world})`);
};
const zoneEdge = (name, side) => (i) => {
	const zone = zoneById.get(`band${i}${name}`);
	return zone && (side < 0 ? zone.x : zone.x + zone.w);
};
const salmonHalf = halfOf('salmon');
/** The first rock from the sea with five cells of open water round it. */
const rock = [...river.rocks]
	.sort((a, b) => b.y - a.y)
	.find((r) => {
		const centre = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
		const bands = river.bands.filter(
			(band) => band.y < r.y + r.h + 6 * CELL && band.y + band.h > r.y - 6 * CELL,
		);
		return (
			!hazard(centre, { rocks: -CELL, falls: 8 * CELL }) &&
			!river.rocks.some((other) => other !== r && near(centre, other, 6 * CELL)) &&
			bands.every((band) => band.left + 6 * CELL < r.x && r.x + r.w < band.right - 6 * CELL)
		);
	});
if (!rock) throw new Error(`level ${SEED}: no rock with open water round it`);
/** Open water: the first place from the sea where the sim's salmon swims 3 s straight upstream at
 *  its full speed against the current, nothing in its way or pulling at it. */
const openWater = (() => {
	const salmon = level.online.characters.find((c) => c.id === 'salmon');
	for (let i = river.bands.length - 7; i >= 6; i--) {
		const band = river.bands[i];
		const at = { x: (band.left + band.right) / 2, y: band.y + band.h / 2 };
		if (hazard(at)) continue;
		const { path, free } = trial('on', 'salmon', at, UP);
		const straight = path.every((point) => Math.abs(point.x - at.x) < 1);
		const swum = path[0].y - path.at(-1).y;
		if (free && straight && swum > 0.98 * 3 * (salmon.speed - band.current)) return at;
	}
	throw new Error(`level ${SEED}: no open water`);
})();
/** The first waterfall from the sea whose foot is open water in the middle. */
const fallSite = (() => {
	for (const fall of [...river.waterfalls].sort((a, b) => b.y - a.y)) {
		const below = river.bands.find((band) => band.y === lineOf(fall));
		if (!below) continue;
		const at = { x: (below.left + below.right) / 2, y: lineOf(fall) + 3 * CELL };
		if (!hazard(at, { falls: 0 })) return { at, fall };
	}
	throw new Error(`level ${SEED}: no waterfall with an open foot`);
})();
const bearBlock = level.zones.find(
	(zone) => /^waterfall\d+Bear$/.test(zone.id) && Math.abs(zone.y - fallSite.fall.y) < 4 * CELL,
);

/** The delta is wide and its banks are flat; from here up the river is the narrow one. */
const MIDDLE = river.bands.length >> 1;
const sites = {
	salmonLeft: bankSite('salmon', [-1, -1], (i) => river.bands[i].left, 1),
	salmonRight: bankSite('salmon', [1, -1], (i) => river.bands[i].right, -1),
	salmonLeftUp: bankSite('salmon', [-1, -1], (i) => river.bands[i].left, 1, MIDDLE),
	salmonRightUp: bankSite('salmon', [1, -1], (i) => river.bands[i].right, -1, MIDDLE),
	bearLimit: bankSite('bear', [-1, -1], zoneEdge('BeyondbearLeft', 1), 1),
	fishermanLimit: bankSite('fisherman', [1, -1], zoneEdge('BeyondfishermanRight', -1), -1),
	fishermanWater: bankSite('fisherman', [1, -1], zoneEdge('WaterFisherman', -1), -1),
};
const rockCentre = { x: rock.x + rock.w / 2, y: rock.y + rock.h / 2 };
const underRock = rock.y + rock.h + salmonHalf.h + CELL;
/** A corner case starts with a quarter of a cell of the salmon under the rock. */
const CLIP = CELL / 4;

/**
 * THE CASES, by class. `glide`: a bank or a rock, which the slide must carry the player along or
 * round; `must`: what the room's path must hold to (true = held), whatever the slide.
 */
const CASES = {
	salmon: [
		{ name: 'open water, upstream (the baseline)', at: openWater, world: UP, baseline: true },
		{ name: 'left bank, diagonally upstream', ...sites.salmonLeft, world: [-1, -1], glide: 'bank' },
		{
			name: 'right bank, diagonally upstream',
			...sites.salmonRight,
			world: [1, -1],
			glide: 'bank',
		},
		{
			name: 'left bank up the river, diagonally upstream',
			...sites.salmonLeftUp,
			world: [-1, -1],
			glide: 'bank',
		},
		{
			name: 'right bank up the river, diagonally upstream',
			...sites.salmonRightUp,
			world: [1, -1],
			glide: 'bank',
		},
		{ name: 'left bank, straight in', ...sites.salmonLeft, world: [-1, 0], must: {} },
		{
			name: 'rock, from below its centre',
			at: { x: rockCentre.x, y: underRock },
			world: UP,
			glide: 'rock',
		},
		{
			name: 'rock, from below its low-x corner',
			at: { x: rock.x - salmonHalf.w + CLIP, y: underRock },
			world: UP,
			glide: 'rock',
		},
		{
			name: 'rock, from below its high-x corner',
			at: { x: rock.x + rock.w + salmonHalf.w - CLIP, y: underRock },
			world: UP,
			glide: 'rock',
		},
		{
			name: 'rock, from its side',
			at: { x: rock.x + rock.w + salmonHalf.w + CELL, y: rockCentre.y - CELL },
			world: [-1, 0],
			glide: 'rock',
		},
		{
			name: "a waterfall's foot, upstream, no tap",
			at: fallSite.at,
			world: UP,
			must: {
				what: 'stays below the waterfall',
				holds: (path) => path.every((point) => point.y > lineOf(fallSite.fall)),
				reached: (path) =>
					Math.min(...path.map((point) => point.y)) - salmonHalf.h - lineOf(fallSite.fall),
			},
		},
	],
	bear: [
		{ name: 'bank limit, diagonally', ...sites.bearLimit, world: [-1, -1], glide: 'bank' },
		{ name: 'bank limit, straight in', ...sites.bearLimit, world: [-1, 0], must: {} },
		...(bearBlock
			? [
					{
						name: "a waterfall's bear block, from below",
						at: { x: fallSite.at.x, y: bearBlock.y + bearBlock.h + halfOf('bear').h + CELL },
						world: UP,
						must: {
							what: 'stays below the block',
							holds: (path) => path.every((point) => point.y > bearBlock.y + bearBlock.h),
							reached: (path) =>
								Math.min(...path.map((point) => point.y)) -
								halfOf('bear').h -
								(bearBlock.y + bearBlock.h),
						},
					},
				]
			: []),
	],
	fisherman: [
		{ name: 'bank limit, diagonally', ...sites.fishermanLimit, world: [1, -1], glide: 'bank' },
		{ name: "water's edge, diagonally", ...sites.fishermanWater, world: [1, -1], glide: 'bank' },
		{ name: "water's edge, straight in", ...sites.fishermanWater, world: [1, 0], must: {} },
	],
};

const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) =>
		Object.fromEntries(
			[...BUILTIN_COMPONENTS, ...SALMONS_CHARACTER_COMPONENTS].map((d) => [d.id, d]),
		)[id],
);
const work = mkdtempSync(join(tmpdir(), 'salmons-slide-play-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
const configDir = join(work, 'configs');
mkdirSync(configDir);
const bundleOf = (mode) =>
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config: configs[mode],
		flowV2: SALMONS_SEED_DOC,
	});
writeFileSync(join(snapshot, 'runtime.json'), bundleOf('on'));
writeFileSync(join(work, 'runtime-off.json'), bundleOf('off'));
for (const mode of MODES)
	writeFileSync(join(configDir, `${gameKey(mode)}.json`), JSON.stringify(configs[mode]));

const tree = testServerTree(join(work, 'tree'), resolve(opt.runtime), KEY, {
	protocol: 'freePlay',
	name: 'Salmons',
	projectKey: KEY,
});
const server = await startTestServer(tree, {});
const snaps = {
	on: await serveSnapshot({
		dir: snapshot,
		name: 'Salmons',
		snapshotId: 'salmons-slide-on',
		assetBase: `${server.origin}/${KEY}/`,
	}),
	off: await serveSnapshot({
		dir: snapshot,
		bundleFile: join(work, 'runtime-off.json'),
		name: 'Salmons',
		snapshotId: 'salmons-slide-off',
	}),
};
const roomsPort = 20000 + Math.floor(Math.random() * 20000);
const rooms = createGameServer({
	loadGame: createConfigSource({ dir: configDir }),
	maxRooms: 12,
	commit: 'playtest',
	gracefullyShutdown: false,
});
await rooms.listen(roomsPort);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HOOK = `(() => {
	const errors = (window.__AR_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
})();`;
/** The page's own player as its probe has it: drawn (predicted), the room's as the page last
 *  heard it, and the predictor's counters. */
const OWN = `(() => {
	const state = window.__IE_DETERMINISM__.state();
	const online = state.arcade?.online;
	if (!online) return null;
	const own = (list) => {
		const mine = (list ?? []).find((entry) => entry.id === online.me);
		return mine ? { x: mine.x, y: mine.y } : null;
	};
	return {
		frame: state.frame,
		me: online.me,
		art: !!online.art,
		drawn: own(online.drawn),
		heard: own(state.arcade.bodies),
		corrections: online.corrections ?? 0,
		snaps: online.snaps ?? 0,
	};
})()`;

/** A page playing `character` in `mode`'s game, joined, its art drawn, its room's sim in hand. */
async function boot(mode, character) {
	const page = await openPage(headlessShell(opt.chrome), join(work, `${mode}-${character}`));
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	const params = new URLSearchParams({
		runtime: '1',
		project: KEY,
		k: 'slide-play',
		editorDocBase: snaps[mode].origin,
		lang: 'en',
		currency: 'USD',
		device: 'desktop',
		ie_determinism: '7',
		rooms_url: `ws://127.0.0.1:${roomsPort}`,
		rooms_game: gameKey(mode),
		rooms_character: character,
		rooms_name: 'Sli',
	});
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await wait(100);
	}
	await playScenario(
		{ steps: [{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 }, { op: 'tapToStart' }] },
		{ page, draw: 'last' },
	);
	const own = () => page.evaluate(OWN);
	/** Run `frames` of the page's clock, no faster than the wall clock; `each(own)` after each run
	 *  of up to four. Returns the frames a wall-clock second got. */
	const advance = async (frames, each) => {
		const started = Date.now();
		for (let done = 0; done < frames;) {
			const due = Math.floor(((Date.now() - started) * FPS) / 1000) - done;
			if (due < 1) {
				await wait(4);
				continue;
			}
			const run = Math.min(due, 4, frames - done);
			const now = await page.evaluate(
				`window.__IE_DETERMINISM__.step(${run}, { draw: 'last' }).then(() => ${OWN})`,
			);
			done += run;
			each?.(now);
		}
		return Math.round((frames * 1000) / (Date.now() - started));
	};
	let joined;
	for (let i = 0; i < 240 && !joined?.art; i++) {
		await advance(15);
		joined = await own();
	}
	if (!joined?.art) throw new Error(`${mode} ${character}: the page never drew its room`);
	const me = joined.me;
	let sim;
	for (const listed of await matchMaker.query({})) {
		const held = matchMaker.getLocalRoomById(listed.roomId)?.sim;
		if (held?.players.has(me)) sim = held;
	}
	if (!sim) throw new Error(`${mode} ${character}: no room holds the page's player`);
	const player = sim.players.get(me);
	if (player.status !== STATUS.free) throw new Error(`${mode} ${character}: not free in its room`);
	// The room's own path, a point a step.
	const trace = [];
	const step = sim.step;
	sim.step = (take) => {
		const events = step.call(sim, take);
		trace.push({ x: player.body.x, y: player.body.y });
		return events;
	};
	const key = async (codes, type) => {
		for (const code of codes)
			await page.page('Input.dispatchKeyEvent', {
				type: type === 'down' ? 'rawKeyDown' : 'keyUp',
				key: code,
				code,
				windowsVirtualKeyCode: VIRTUAL_KEY[code],
			});
	};
	const truth = () => ({ x: player.body.x, y: player.body.y });
	/** Put the player at `at` in the room and run the page until it draws it there. Returns the
	 *  corrections the page counted for it. */
	const place = async (at) => {
		const before = await own();
		Object.assign(player.body, at);
		for (let i = 0; i < 40; i++) {
			await advance(6);
			const now = await own();
			if (now.drawn && dist(now.drawn, truth()) < CELL / 3 && dist(now.heard, truth()) < CELL / 3)
				break;
		}
		await advance(12);
		return (await own()).corrections - before.corrections;
	};
	/** Hold `keys` for `frames`: the room's path meanwhile and until the page is at rest again,
	 *  what the page drew, and the predictor's counters over it. */
	const hold = async (keys, frames) => {
		const before = await own();
		trace.length = 0;
		const start = truth();
		const samples = [];
		await key(keys, 'down');
		const fps = await advance(frames, (now) =>
			samples.push({ frame: now.frame, drawn: now.drawn, room: truth() }),
		);
		const held = trace.length;
		await key(keys, 'up');
		await advance(FPS / 2);
		const after = await own();
		return {
			start,
			samples,
			path: [start, ...trace],
			held: [start, ...trace.slice(0, held)],
			fps,
			corrections: after.corrections - before.corrections,
			snaps: after.snaps - before.snaps,
			restGap: dist(after.drawn, truth()),
		};
	};
	return { page, sim, player, place, hold, own };
}

/** How far a point is off a path (a polyline), px. */
const offPath = (point, path) => {
	let least = Infinity;
	for (let i = 1; i < path.length; i++) {
		const a = path[i - 1];
		const b = path[i];
		const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
		const t = len2
			? Math.max(
					0,
					Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / len2),
				)
			: 0;
		least = Math.min(least, dist(point, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }));
	}
	return least;
};
const median = (list) => [...list].sort((a, b) => a - b)[list.length >> 1] ?? 0;
const round1 = (value) => Math.round(value * 10) / 10;

/** One case played on a page: what the room did, and how the page's drawing kept to it. */
async function play(game, character, each) {
	const keys = keysFor(each.world);
	const placed = await game.place(each.at);
	const run = await game.hold(keys, HOLD_FRAMES);
	const perSecond = [];
	for (let i = 0; i < run.samples.length; i++) {
		const later = run.samples.find((sample) => sample.frame >= run.samples[i].frame + FPS);
		if (later) perSecond.push(dist(run.samples[i].room, later.room));
	}
	const slowest = Math.min(...perSecond);
	const off = run.samples.map((sample) => offPath(sample.drawn, run.path));
	const lead = run.samples.map((sample) => dist(sample.drawn, sample.room));
	return {
		name: each.name,
		keys: named(keys),
		world: each.world,
		start: { x: Math.round(run.start.x), y: Math.round(run.start.y) },
		end: { x: Math.round(run.held.at(-1).x), y: Math.round(run.held.at(-1).y) },
		travelled: Math.round(dist(run.start, run.held.at(-1))),
		slowestSecond: Math.round(slowest),
		stuck: slowest < STUCK_PX,
		fps: run.fps,
		placed,
		corrections: run.corrections,
		snaps: run.snaps,
		offPath: { max: round1(Math.max(...off)), median: round1(median(off)) },
		lead: { max: round1(Math.max(...lead)), median: round1(median(lead)) },
		restGap: round1(run.restGap),
		inSolid: round1(Math.max(...run.path.map((point) => depthIn(character, point)))),
		offField: run.path.some((point) => offField(character, point)),
		...(each.must?.holds
			? { held: each.must.holds(run.path), short: round1(each.must.reached(run.path)) }
			: {}),
	};
}

const result = { seed: SEED, tickHz, slide: configs.on.arcade.online.slide, keys: [], cases: {} };
const errors = [];
try {
	for (const mode of MODES) {
		result.cases[mode] = {};
		for (const character of Object.keys(CASES)) {
			const game = await boot(mode, character);
			// What each key direction is in the world: a bear on land, where nothing drifts.
			if (mode === 'on' && character === 'bear') {
				const land = {
					x: sites.bearLimit.at.x + 5 * CELL,
					y: sites.bearLimit.at.y,
				};
				for (const keys of KEY_SETS) {
					await game.place(land);
					const { start, held } = await game.hold(keys, FPS / 2);
					const moved = { x: held.at(-1).x - start.x, y: held.at(-1).y - start.y };
					const length = Math.hypot(moved.x, moved.y) || 1;
					result.keys.push({
						keys: named(keys),
						sends: moveOf(keys),
						moved: { x: round1(moved.x / length), y: round1(moved.y / length) },
					});
				}
			}
			result.cases[mode][character] = [];
			for (const each of CASES[character]) {
				result.cases[mode][character].push(await play(game, character, each));
				const file = `${mode}-${character}-${result.cases[mode][character].length}.png`;
				writeFileSync(join(out, file), await game.page.screenshot());
			}
			errors.push(...(await game.page.evaluate('window.__AR_ERRORS__').catch(() => [])));
			await game.page.close();
		}
	}
} finally {
	server.stop();
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await rooms.close();
	await snaps.on.close();
	await snaps.off.close();
	rmSync(work, { recursive: true, force: true });
}

const verdicts = [];
const verdict = (name, ok, detail) => verdicts.push({ name, ok, detail });
const rows = (mode) =>
	Object.entries(result.cases[mode]).flatMap(([character, list]) =>
		list.map((row, i) => ({ character, each: CASES[character][i], ...row })),
	);
const on = rows('on');
const off = rows('off');
const baseline = {
	on: on.find((row) => row.each.baseline),
	off: off.find((row) => row.each.baseline),
};
/** A glide's drawing may be this far off the room's path: the open-water swim's own, without the
 *  slide, and a quarter of a cell. */
const OFF_PATH_PX = baseline.off.offPath.max + CELL / 4;

console.log(`\nLevel ${SEED}, slide ${JSON.stringify(result.slide)}, ${tickHz} steps a second.\n`);
console.log('| Keys | Sent (moveX, moveY) | The room moved the bear along (x, y) |');
console.log('| --- | --- | --- |');
for (const row of result.keys)
	console.log(
		`| ${row.keys} | ${row.sends.moveX}, ${row.sends.moveY} | ${row.moved.x}, ${row.moved.y} |`,
	);
console.log(
	'\n| Class | Case | Keys | OFF stuck | OFF px in 3 s | OFF slowest s | ON stuck | ON px in 3 s | ON slowest s |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
on.forEach((row, i) =>
	console.log(
		`| ${row.character} | ${row.name} | ${row.keys} | ${off[i].stuck ? 'STUCK' : 'no'} | ${off[i].travelled} | ${off[i].slowestSecond} | ${row.stuck ? 'STUCK' : 'no'} | ${row.travelled} | ${row.slowestSecond} |`,
	),
);
console.log(
	'\n| Slide | Class | Case | corrections | snaps | drawn off the room’s path, max / median px | drawn ahead of the room, max / median px | apart at rest, px | page fps |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [mode, list] of [
	['OFF', off],
	['ON', on],
])
	for (const row of list)
		console.log(
			`| ${mode} | ${row.character} | ${row.name} | ${row.corrections} | ${row.snaps} | ${row.offPath.max} / ${row.offPath.median} | ${row.lead.max} / ${row.lead.median} | ${row.restGap} | ${row.fps} |`,
		);
console.log(
	'\n| Slide | Class | Case | deepest in a solid, px | off the field | held | short of the line, px |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const [mode, list] of [
	['OFF', off],
	['ON', on],
])
	for (const row of list.filter((entry) => entry.each.must))
		console.log(
			`| ${mode} | ${row.character} | ${row.name} | ${row.inSolid} | ${row.offField ? 'YES' : 'no'} | ${row.held ?? '–'} | ${row.short ?? '–'} |`,
		);
console.log('');

const glides = on.filter((row) => row.each.glide);
const brief = (list) => list.map((row) => `${row.character}: ${row.name}`);
for (const kind of ['bank', 'rock']) {
	const stuck = glides.filter((row) => row.each.glide === kind && row.stuck);
	verdict(`slide on: no ${kind} case is stuck`, stuck.length === 0, brief(stuck));
}
const snapped = glides.filter((row) => row.snaps > 0);
verdict('slide on: no glide snaps the own player', snapped.length === 0, brief(snapped));
const astray = glides.filter((row) => row.offPath.max > OFF_PATH_PX);
verdict(
	`slide on: a glide is drawn within ${round1(OFF_PATH_PX)} px of the room's path (the open-water swim's ${baseline.off.offPath.max} px and a quarter of a cell)`,
	astray.length === 0,
	astray.map((row) => `${row.character}: ${row.name}: ${row.offPath.max} px`),
);
const apart = glides.filter((row) => row.restGap > baseline.off.restGap + CELL / 4);
verdict(
	'slide on: after a glide the page rests where the room has it',
	apart.length === 0,
	brief(apart),
);
const passed = on.filter((row) => row.held === false);
verdict(
	'slide on: the salmon stays below the waterfall with no tap, the bear below its block',
	passed.length === 0 && on.filter((row) => row.held === true).length >= 1,
	brief(passed),
);
const inside = on.filter((row) => row.inSolid > 0.5);
verdict(
	'slide on: nobody is ever inside a solid of its class (the fisherman out of the water, the bear inside its limit)',
	inside.length === 0,
	inside.map((row) => `${row.character}: ${row.name}: ${row.inSolid} px`),
);
verdict('slide on: nobody leaves the field', !on.some((row) => row.offField));
verdict(
	"the predictor's counters are live: the page counts a correction for every placement",
	[...on, ...off].every((row) => row.placed >= 1),
);
verdict(
	'the keys are the screen’s: Up + Left is straight up the river',
	result.keys.some((row) => row.keys === 'Left + Up' && row.moved.x === 0 && row.moved.y === -1),
);
verdict('no page error', errors.length === 0, errors);

for (const v of verdicts) {
	console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
	if (!v.ok && v.detail?.length) console.log(`        ${JSON.stringify(v.detail)}`);
}
const failed = verdicts.filter((v) => !v.ok).length;
console.log(
	failed ? `\nsalmons slide play: ${failed} FAILED` : `\nsalmons slide play: OK → ${out}`,
);
process.exit(failed ? 1 : 0);
