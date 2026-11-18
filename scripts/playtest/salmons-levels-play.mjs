// Plays SALMONS ON THE ORIGINAL GAME'S LEVEL (docs/design/salmons-levels.md) in a headless shell
// against a real game server on localhost: the exported config (`salmonsMap`, no pinned seeds), so
// the room picks a random level and the page makes it from the seed the room's state carries. It
// checks: the page made the level the room's seed makes in Node (`generatedOnlineGame`, the server's
// own function), drew it in the original art (one rock and whirlpool per generated one, a waterfall
// face per waterfall, sand), the own salmon swims upstream on ArrowUp (tapping Space off the delta's
// sand), and no page error. It prints
// how long the art took and the page's JS heap, since the original's river is about 2.7× longer and
// 3.8× wider than P10.16's. A second config pins one seed, and its room must play it.
// A pinned level with a waterfall of height 8 added by an overlay near the sea: a cliff stands under
// every waterfall, Space climbs it in place and the salmon swims over, drawn raised past it.
// Project art (docs/status/salmons.md "Original art as project art"): a third page boots a snapshot
// whose editor art ships the project sheets `salmons_terrain` (every ground tile painted magenta, at
// the built-in frames) and `salmons_waterfall_face`: its banks and waterfalls are drawn from them, and the other pages, with no such sheet, draw
// the built-in tiles.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/salmons-levels-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]
//
// The runtime must play arcade: build it with `PUBLIC_IE_FAMILIES=arcade pnpm --filter lines build`.
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { PNG } from 'pngjs';

import { generatedOnlineGame } from '../../packages/engine-mechanics/src/onlineGenerators.js';
import { salmonsConfig } from '../../packages/engine-mechanics/src/salmons.js';
import {
	CELL,
	SALMONS_MAP,
	SALMONS_MAP_SEED,
	buildMeanderTable,
	meanderAt,
	salmonsMapRiver,
} from '../../packages/engine-mechanics/src/salmonsMap.js';
import { SALMONS_SHEETS } from '../../packages/engine-layout/src/lib/salmonsArt/sheets/frames.ts';
import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { SALMONS_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import { normalizeGameConfigDoc, onlineGameOf } from '../../packages/game-config/index.ts';
import { createConfigSource } from '../../services/game-server/src/configSource.ts';
import { createGameServer } from '../../services/game-server/src/server.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/salmons-levels-play') },
		chrome: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'salmons';
const PINNED = 31337;

const river = salmonsMapRiver(SALMONS_MAP_SEED);
const authored = salmonsConfig(river);
// Bears that stand still: nothing hunts the salmon while it swims.
authored.arcade.online.bots.characters = authored.arcade.online.bots.characters.filter(
	(bot) => bot.character === 'bear',
);
for (const character of authored.arcade.characters)
	character.brain = {
		initial: 'rest',
		states: [{ id: 'rest', behaviour: 'idle' }],
		transitions: [],
	};
const config = normalizeGameConfigDoc(authored);
const pinned = normalizeGameConfigDoc({
	...authored,
	arcade: {
		...authored.arcade,
		online: { ...authored.arcade.online, levels: { seeds: [PINNED] } },
	},
});
const doc = salmonsReferenceLayout(river);
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...SALMONS_CHARACTER_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const result = { verdicts: [], measures: {} };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });

const work = mkdtempSync(join(tmpdir(), 'salmons-levels-play-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({ doc, componentDefs, componentDefaults: {}, config, flowV2: SALMONS_SEED_DOC }),
);
const configs = join(work, 'configs');
mkdirSync(configs);
writeFileSync(join(configs, `${KEY}.json`), JSON.stringify(config));
writeFileSync(join(configs, 'salmons-pinned.json'), JSON.stringify(pinned));
// Waterfall heights (2026-11-17): the pinned level with a waterfall of height 8 added four cells
// upstream of where salmon start, so a page meets it at once.
const CLIFF_GX = SALMONS_MAP.RIVER_LENGTH - 14;
const cliffCell = [CLIFF_GX, Math.round(meanderAt(buildMeanderTable(String(PINNED)), CLIFF_GX))];
const cliffConfig = normalizeGameConfigDoc({
	...authored,
	arcade: {
		...authored.arcade,
		online: {
			...authored.arcade.online,
			levels: {
				seeds: [PINNED],
				overlays: { [PINNED]: { add: [{ cell: cliffCell, kind: 'waterfall', height: 8 }] } },
			},
		},
	},
});
writeFileSync(join(configs, 'salmons-cliff.json'), JSON.stringify(cliffConfig));
// A room with a lobby that needs two people, so two pages start it (the lobby screen, then its
// countdown, then round 1).
const LOBBY = { minPlayers: 2, maxWaitSeconds: 120, countdownSeconds: 20 };
writeFileSync(
	join(configs, 'salmons-lobby.json'),
	JSON.stringify(
		normalizeGameConfigDoc({
			...authored,
			arcade: {
				...authored.arcade,
				online: {
					...authored.arcade.online,
					rules: { ...authored.arcade.online.rules, lobby: LOBBY },
				},
			},
		}),
	),
);

const HOOK = `(() => {
	const errors = (window.__AR_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
})();`;

const tree = testServerTree(join(work, 'tree'), resolve(opt.runtime), KEY, {
	protocol: 'freePlay',
	name: 'Salmons',
	projectKey: KEY,
});
const server = await startTestServer(tree, {});
const snap = await serveSnapshot({
	dir: snapshot,
	name: 'Salmons',
	snapshotId: 'salmons',
	assetBase: `${server.origin}/${KEY}/`,
});
// The project's `salmons_terrain` sheet as a publish ships it (`deploy/editor-art/`, listed in
// `editorArt` by its manifest key): the built-in frames, every pixel magenta.
const MAGENTA = [255, 0, 255];
const terrain = SALMONS_SHEETS.terrain;
const terrainPage = new PNG({ width: terrain.meta.size.w, height: terrain.meta.size.h });
for (let i = 0; i < terrainPage.data.length; i += 4) terrainPage.data.set([...MAGENTA, 255], i);
mkdirSync(join(snapshot, 'deploy', 'editor-art'), { recursive: true });
writeFileSync(
	join(snapshot, 'deploy', 'editor-art', 'salmons_terrain.png'),
	PNG.sync.write(terrainPage),
);
writeFileSync(
	join(snapshot, 'deploy', 'editor-art', 'salmons_terrain.json'),
	JSON.stringify({ ...terrain, meta: { ...terrain.meta, image: 'salmons_terrain.png' } }),
);
// And `salmons_waterfall_face`, the tile a TilingSprite scrolls, as its own one-region sheet.
const FACE = { w: 256, h: 64 };
const facePage = new PNG({ width: FACE.w, height: FACE.h });
for (let i = 0; i < facePage.data.length; i += 4) facePage.data.set([...MAGENTA, 255], i);
writeFileSync(
	join(snapshot, 'deploy', 'editor-art', 'salmons_waterfall_face.png'),
	PNG.sync.write(facePage),
);
const faceFrame = { x: 0, y: 0, ...FACE };
writeFileSync(
	join(snapshot, 'deploy', 'editor-art', 'salmons_waterfall_face.json'),
	JSON.stringify({
		frames: {
			waterfall_face: {
				frame: faceFrame,
				rotated: false,
				trimmed: false,
				spriteSourceSize: faceFrame,
				sourceSize: FACE,
			},
		},
		meta: { image: 'salmons_waterfall_face.png', format: 'RGBA8888', size: FACE, scale: '1' },
	}),
);
const withProjectArt = join(work, 'runtime-project-art.json');
writeFileSync(
	withProjectArt,
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config,
		flowV2: SALMONS_SEED_DOC,
		editorArt: {
			sheets: [
				{
					key: `invisible_wall/${KEY}/manifests/atlas_manifest_salmons_terrain.json`,
					json: 'editor-art/salmons_terrain.json',
				},
				{
					key: `invisible_wall/${KEY}/manifests/atlas_manifest_salmons_waterfall_face.json`,
					json: 'editor-art/salmons_waterfall_face.json',
				},
			],
			images: [],
		},
	}),
);
const snapProjectArt = await serveSnapshot({
	dir: snapshot,
	bundleFile: withProjectArt,
	name: 'Salmons',
	snapshotId: 'salmons-project-art',
});
// The cliff room's device must make the level from the same config (its overlay) as the server.
const withCliff = join(work, 'runtime-cliff.json');
writeFileSync(
	withCliff,
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config: cliffConfig,
		flowV2: SALMONS_SEED_DOC,
	}),
);
const snapCliff = await serveSnapshot({
	dir: snapshot,
	bundleFile: withCliff,
	name: 'Salmons',
	snapshotId: 'salmons-cliff',
});
/** The share of a screenshot's pixels that are the project sheet's magenta. */
const magentaShare = (shot) => {
	const { data } = PNG.sync.read(shot);
	let hits = 0;
	for (let i = 0; i < data.length; i += 4)
		if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] > 200) hits += 1;
	return hits / (data.length / 4);
};

const roomsPort = 20000 + Math.floor(Math.random() * 20000);
const rooms = createGameServer({
	loadGame: createConfigSource({ dir: configs }),
	maxRooms: 8,
	commit: 'playtest',
	gracefullyShutdown: false,
});
await rooms.listen(roomsPort);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(profile, extra) {
	const page = await openPage(headlessShell(opt.chrome), join(work, profile));
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	await page.page('Performance.enable');
	const params = new URLSearchParams({
		runtime: '1',
		project: KEY,
		k: 'levels-play',
		editorDocBase: snap.origin,
		lang: 'en',
		currency: 'USD',
		device: 'desktop',
		ie_determinism: '7',
		rooms_url: `ws://127.0.0.1:${roomsPort}`,
		rooms_character: 'salmon',
		...extra,
	});
	const started = Date.now();
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await wait(100);
	}
	const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
	const play = (steps) => playScenario({ steps }, { page, draw: 'last' });
	await play([{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 }, { op: 'tapToStart' }]);
	const state = () => api('state()');
	const settle = async (ms) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			await play([{ op: 'step', frames: 6 }]);
			await wait(50);
		}
	};
	let artMs;
	for (let i = 0; i < 120 && artMs === undefined; i++) {
		await settle(500);
		if ((await state()).arcade?.online?.art) artMs = Date.now() - started;
	}
	// The keys are the screen's on the isometric river (`online.ts` `keysOf`): up the river (world
	// −y, drawn up and right until the world is mirrored) is Up + Right.
	const key = async (name, type) => {
		for (const code of name === 'ArrowUp' ? ['ArrowUp', 'ArrowRight'] : [name])
			await page.page('Input.dispatchKeyEvent', {
				type: type === 'down' ? 'rawKeyDown' : 'keyUp',
				key: { Space: ' ' }[code] ?? code,
				code,
				windowsVirtualKeyCode: { ArrowUp: 38, ArrowRight: 39, Space: 32 }[code],
			});
	};
	const shown = () =>
		page.evaluate(
			'(() => { const f = window.__IE_FLOW_V2__; return f ? f.ordered().map((c) => c.id) : []; })()',
		);
	return { page, state, settle, key, artMs, shown };
}

const heapOf = async (page) => {
	const { result: metrics } = await page.page('Performance.getMetrics');
	const m = Object.fromEntries((metrics?.metrics ?? []).map((x) => [x.name, x.value]));
	return Math.round((m.JSHeapUsedSize ?? 0) / 1e6);
};

try {
	const a = await boot('a', { rooms_name: 'Ann' });
	const online = (await a.state()).arcade?.online ?? {};
	const made =
		typeof online.seed === 'number' ? generatedOnlineGame(onlineGameOf(config), online.seed) : null;
	verdict('the page joined a room carrying a seed', typeof online.seed === 'number', {
		seed: online.seed,
	});
	verdict(
		"the page made the room seed's level, the server's own generator's (zones alike)",
		!!made &&
			online.fieldDrawn === true &&
			JSON.stringify(online.zones) ===
				JSON.stringify(made.game.zones.map((z) => [z.id, z.x, z.y, z.w, z.h])),
		{ drawn: online.fieldDrawn, zones: online.zones?.length, expected: made?.game.zones.length },
	);
	const regions = online.art?.regions ?? {};
	const sum = (prefix) =>
		Object.entries(regions)
			.filter(([name]) => name.startsWith(prefix))
			.reduce((n, [, c]) => n + c, 0);
	const level = made?.made;
	verdict(
		'the level is drawn in the original art: its rocks, whirlpools, waterfalls and sand',
		!!level &&
			sum('rock_') === level.rocks.length &&
			sum('whirlpool_') === level.whirlpools.length * 4 &&
			(regions.waterfall_face ?? 0) === level.waterfalls.length * 2 &&
			sum('sand_') > 0 &&
			sum('tree_') > 50,
		{
			rocks: [sum('rock_'), level?.rocks.length],
			pools: [sum('whirlpool_'), level?.whirlpools.length],
		},
	);
	result.measures.artMs = a.artMs;
	result.measures.heapMB = await heapOf(a.page);
	const me = (await a.state()).arcade?.online?.me;
	const yOf = async () =>
		(await a.state()).arcade?.online?.drawn?.find((d) => d.id === me)?.y ?? Number.NaN;
	const before = await yOf();
	await a.key('ArrowUp', 'down');
	const t0 = Date.now();
	const f0 = (await a.state()).frame;
	// Tapping Space as it swims: a delta sand island grounds a salmon until it jumps.
	for (let i = 0; i < 12; i++) {
		await a.key('Space', 'down');
		await a.settle(250);
		await a.key('Space', 'up');
		await a.settle(250);
	}
	result.measures.fps = Math.round((((await a.state()).frame - f0) * 1000) / (Date.now() - t0));
	await a.key('ArrowUp', 'up');
	const after = await yOf();
	verdict('ArrowUp (and Space off the sand) swims the salmon upstream', after < before - 100, {
		before,
		after,
	});
	const levelShot = await a.page.screenshot();
	writeFileSync(join(out, 'level.png'), levelShot);
	const builtinMagenta = magentaShare(levelShot);
	const errors = await a.page.evaluate('window.__AR_ERRORS__');
	verdict('no page error', errors.length === 0, errors);
	await a.page.close();

	const pa = await boot('pa', { rooms_name: 'Pat', editorDocBase: snapProjectArt.origin });
	const paArt = (await pa.state()).arcade?.online?.art;
	await pa.settle(1000);
	const projectShot = await pa.page.screenshot();
	writeFileSync(join(out, 'project-art.png'), projectShot);
	const projectMagenta = magentaShare(projectShot);
	result.measures.magenta = { builtin: builtinMagenta, project: projectMagenta };
	verdict(
		"a snapshot shipping the project's salmons_terrain draws the banks from it",
		!!paArt && projectMagenta > 0.05,
		{ share: projectMagenta },
	);
	verdict('without it the built-in tiles are drawn (no magenta)', builtinMagenta < 0.001, {
		share: builtinMagenta,
	});
	const paRegions = (await pa.state()).arcade?.online?.art?.regions ?? {};
	verdict(
		'with the project’s face tile the waterfalls still draw (the TilingSprite path)',
		(paRegions.waterfall_face ?? 0) > 0,
		{
			faces: paRegions.waterfall_face,
		},
	);
	const paErrors = await pa.page.evaluate('window.__AR_ERRORS__');
	verdict('no page error with the project art', paErrors.length === 0, paErrors);
	await pa.page.close();

	const p = await boot('p', { rooms_name: 'Pia', rooms_game: 'salmons-pinned' });
	const pSeed = (await p.state()).arcade?.online?.seed;
	verdict('a config that pins a seed: its room plays that level', pSeed === PINNED, {
		seed: pSeed,
	});
	await p.page.close();

	const c = await boot('c', {
		rooms_name: 'Cy',
		rooms_game: 'salmons-cliff',
		editorDocBase: snapCliff.origin,
	});
	const cliffLevel = generatedOnlineGame(onlineGameOf(cliffConfig), PINNED).made;
	const line = (cliffLevel.grid.sourceRows + CLIFF_GX) * CELL;
	const cRegions = (await c.state()).arcade?.online?.art?.regions ?? {};
	verdict(
		'a cliff of cliff.png stands under every waterfall',
		(cRegions.cliff ?? 0) === cliffLevel.waterfalls.length,
		{ cliffs: cRegions.cliff, waterfalls: cliffLevel.waterfalls.length },
	);
	const meC = (await c.state()).arcade?.online?.me;
	const ownC = async () => {
		const st = await c.state();
		return {
			body: st.arcade?.bodies?.find((b) => b.id === meC),
			drawn: st.arcade?.online?.drawn?.find((d) => d.id === meC),
			events: (st.arcade?.online?.events ?? []).filter((e) => e.id === meC),
		};
	};
	await c.key('ArrowUp', 'down');
	let climbed;
	let climbPose = false;
	let below = true;
	let taps = 0;
	let atFoot;
	for (; taps < 40 && !climbed; taps++) {
		await c.key('Space', 'down');
		await c.settle(150);
		await c.key('Space', 'up');
		await c.settle(350);
		const now = await ownC();
		climbPose ||= (await c.state()).arcade?.online?.art?.looks?.[meC]?.climbing === true;
		climbed = now.events.find((e) => e.type === 'climbed');
		if (!climbed && now.body) {
			below &&= now.body.y > line;
			if (now.body.y < line + 3 * CELL) atFoot ??= now;
		}
		if (atFoot && !climbed && taps % 4 === 0)
			writeFileSync(join(out, 'cliff.png'), await c.page.screenshot());
	}
	await c.settle(2000);
	// The drawn lift eases onto the step once the salmon crosses the lip, which can be well after
	// it is let go at the top: read it only once it has stopped moving.
	let over = await ownC();
	for (let i = 0; i < 40; i++) {
		await c.settle(100);
		const next = await ownC();
		const settled = next.drawn?.ground === over.drawn?.ground && next.body && next.body.y < line;
		over = next;
		if (settled) break;
	}
	await c.key('ArrowUp', 'up');
	writeFileSync(join(out, 'over-the-cliff.png'), await c.page.screenshot());
	const step = 24 + 24 * 8;
	verdict(
		'a waterfall of height 8: Space climbs it in place, and let go at the top the salmon swims over',
		!!climbed && below && !!over.body && over.body.y < line,
		{ climbed, taps, line, foot: atFoot?.body?.y, over: over.body?.y },
	);
	verdict(
		'…and is drawn raised with the river past it (the waterfall’s step, 24 + 24 × 8 px)',
		Math.abs((over.drawn?.ground ?? 0) - (atFoot?.drawn?.ground ?? 0) - step) < 0.5,
		{ before: atFoot?.drawn?.ground ?? 0, after: over.drawn?.ground ?? 0 },
	);
	verdict('…drawn nose up in the climb’s pose while it climbs (the room holds it)', climbPose);
	const cErrors = await c.page.evaluate('window.__AR_ERRORS__');
	verdict('no page error on the raised river', cErrors.length === 0, cErrors);
	await c.page.close();

	const l1 = await boot('l1', { rooms_name: 'Lia', rooms_game: 'salmons-lobby' });
	await l1.settle(1500);
	const waiting = await l1.shown();
	const phase1 = (await l1.state()).arcade?.online?.phase;
	verdict(
		'a room with a lobby: the first person waits on the lobby screen, no countdown yet',
		phase1 === 'waiting' &&
			waiting.includes('salmonsLobby') &&
			!waiting.includes('salmonsCountdown'),
		{ phase: phase1, shown: waiting },
	);
	const l2 = await boot('l2', { rooms_name: 'Leo', rooms_game: 'salmons-lobby' });
	await Promise.all([l1.settle(1500), l2.settle(1500)]);
	const counting = [await l1.shown(), await l2.shown()];
	verdict(
		'the second person starts the countdown: both pages show the lobby and its countdown',
		counting.every((ids) => ids.includes('salmonsLobby') && ids.includes('salmonsCountdown')),
		{ shown: counting },
	);
	await Promise.all([
		l1.settle(LOBBY.countdownSeconds * 1000 + 2500),
		l2.settle(LOBBY.countdownSeconds * 1000 + 2500),
	]);
	const started = [await l1.shown(), await l2.shown()];
	const phases = [
		(await l1.state()).arcade?.online?.phase,
		(await l2.state()).arcade?.online?.phase,
	];
	verdict(
		'when it ends round 1 starts and both pages drop the lobby',
		phases.every((p) => p === 'running') &&
			started.every((ids) => !ids.includes('salmonsLobby') && !ids.includes('salmonsCountdown')),
		{ phases, shown: started },
	);
	writeFileSync(join(out, 'lobby.png'), await l2.page.screenshot());
	await l1.page.close();
	await l2.page.close();
} finally {
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await rooms.close();
	await server.close?.();
	await snap.close?.();
	await snapProjectArt.close?.();
	await snapCliff.close?.();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts) console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
console.log(`  measures: ${JSON.stringify(result.measures)}`);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(
	failed ? `\nsalmons levels play: ${failed} FAILED` : `\nsalmons levels play: OK → ${out}`,
);
process.exit(failed ? 1 : 0);
