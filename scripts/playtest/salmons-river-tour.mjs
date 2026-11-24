// A TOUR OF A SALMONS RIVER in a headless shell against a real game server on localhost: the level
// a seed makes with Salmons' levels (`SALMONS_LEVELS`: the winding river, the tall waterfalls; or
// the original's with `--original`), looked at where it matters. It stands the page's salmon below
// each waterfall, in the middle of each reach that runs across the screen's other diagonal and at
// each sharp bend, and saves a screenshot of each (`<out>/<seed>-<stop>.png`) for a person to look
// at; then it climbs the level's tallest waterfall with the keys. It checks: the page made the
// level the room's seed makes in Node, a cliff stands under every waterfall, each stop is on water
// the page draws its salmon on, the tallest waterfall is climbed by tapping Space and swum over,
// and no page error.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/salmons-river-tour.mjs --runtime apps/lines/build --out <dir> \
//     [--seeds 1,4] [--original] [--chrome <exe>]
//
// The runtime must play arcade: build it with `PUBLIC_IE_FAMILIES=arcade pnpm --filter lines build`.
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { generatedOnlineGame } from '../../packages/engine-mechanics/src/onlineGenerators.js';
import { SALMONS_LEVELS, salmonsConfig } from '../../packages/engine-mechanics/src/salmons.js';
import {
	CELL,
	courseFacts,
	levelShape,
	salmonsMapRiver,
} from '../../packages/engine-mechanics/src/salmonsMap.js';
import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { SALMONS_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import {
	normalizeGameConfigDoc,
	onlineGameOf,
	shapedOnlineGame,
	withLevelsShape,
} from '../../packages/game-config/index.ts';
import { createConfigSource } from '../../services/game-server/src/configSource.ts';
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
		out: { type: 'string', default: join(ROOT, '.cache/salmons-river-tour') },
		seeds: { type: 'string', default: '1' },
		original: { type: 'boolean', default: false },
		chrome: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const levels = opt.original ? undefined : SALMONS_LEVELS;
const seeds = opt.seeds.split(',').map(Number);

const result = { verdicts: [], stops: {} };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const work = mkdtempSync(join(tmpdir(), 'salmons-river-tour-'));
const configs = join(work, 'configs');
mkdirSync(configs);

/** One seed's game: its config (the level pinned, still bears only) under its own key. */
const games = seeds.map((seed) => {
	const river = salmonsMapRiver(seed, undefined, levelShape(levels));
	const authored = salmonsConfig(river, { levels: { ...levels, seeds: [seed] } });
	authored.arcade.online.bots.characters = [{ character: 'bear', brain: 'bearBot' }];
	for (const character of authored.arcade.characters)
		character.brain = {
			initial: 'rest',
			states: [{ id: 'rest', behaviour: 'idle' }],
			transitions: [],
		};
	const config = withLevelsShape(normalizeGameConfigDoc(authored), authored);
	const key = `salmons-${seed}`;
	writeFileSync(join(configs, `${key}.json`), JSON.stringify(config));
	return { seed, key, river, config };
});

const doc = salmonsReferenceLayout(games[0].river);
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...SALMONS_CHARACTER_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);
const KEY = 'salmons';
const tree = testServerTree(join(work, 'tree'), resolve(opt.runtime), KEY, {
	protocol: 'freePlay',
	name: 'Salmons',
	projectKey: KEY,
});
const server = await startTestServer(tree, {});
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
const snaps = [];
for (const game of games) {
	const bundleFile = join(work, `runtime-${game.seed}.json`);
	writeFileSync(
		bundleFile,
		JSON.stringify({
			doc,
			componentDefs,
			componentDefaults: {},
			config: game.config,
			flowV2: SALMONS_SEED_DOC,
		}),
	);
	if (!snaps.length) writeFileSync(join(snapshot, 'runtime.json'), JSON.stringify({}));
	game.snap = await serveSnapshot({
		dir: snapshot,
		bundleFile,
		name: 'Salmons',
		snapshotId: game.key,
		assetBase: `${server.origin}/${KEY}/`,
	});
	snaps.push(game.snap);
}
const roomsPort = 20000 + Math.floor(Math.random() * 20000);
const rooms = createGameServer({
	loadGame: createConfigSource({ dir: configs }),
	maxRooms: 12,
	commit: 'playtest',
	gracefullyShutdown: false,
});
await rooms.listen(roomsPort);

const HOOK = `(() => {
	const errors = (window.__AR_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
})();`;

try {
	for (const game of games) {
		const { seed, key } = game;
		const page = await openPage(headlessShell(opt.chrome), join(work, `p${seed}`));
		await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
		await page.page('Emulation.setDeviceMetricsOverride', {
			width: 1920,
			height: 1080,
			deviceScaleFactor: 1,
			mobile: false,
		});
		const params = new URLSearchParams({
			runtime: '1',
			project: KEY,
			k: 'river-tour',
			editorDocBase: game.snap.origin,
			lang: 'en',
			currency: 'USD',
			device: 'desktop',
			ie_determinism: '7',
			rooms_url: `ws://127.0.0.1:${roomsPort}`,
			rooms_character: 'salmon',
			rooms_name: 'Tour',
			rooms_game: key,
		});
		await page.navigate(`${server.origin}/${KEY}/?${params}`);
		for (let i = 0; i < 300; i++) {
			if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
			await wait(100);
		}
		const play = (steps) => playScenario({ steps }, { page, draw: 'last' });
		await play([{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 }, { op: 'tapToStart' }]);
		const state = () => page.evaluate('window.__IE_DETERMINISM__.state()');
		const settle = async (ms) => {
			const end = Date.now() + ms;
			while (Date.now() < end) {
				await play([{ op: 'step', frames: 6 }]);
				await wait(50);
			}
		};
		for (let i = 0; i < 120; i++) {
			await settle(500);
			if ((await state()).arcade?.online?.art) break;
		}
		const key2 = async (codes, type) => {
			for (const code of codes)
				await page.page('Input.dispatchKeyEvent', {
					type: type === 'down' ? 'rawKeyDown' : 'keyUp',
					key: { Space: ' ' }[code] ?? code,
					code,
					windowsVirtualKeyCode: { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, Space: 32 }[code],
				});
		};
		const first = await state();
		const me = first.arcade?.online?.me;
		const made = generatedOnlineGame(
			shapedOnlineGame(onlineGameOf(game.config), game.config),
			seed,
		).made;
		verdict(
			`seed ${seed}: the page plays the level the seed makes in Node`,
			first.arcade?.online?.seed === seed &&
				first.arcade?.online?.art?.regions?.cliff === made.waterfalls.length,
			{
				seed: first.arcade?.online?.seed,
				cliffs: first.arcade?.online?.art?.regions?.cliff,
				waterfalls: made.waterfalls.length,
			},
		);
		const listed = (await matchMaker.query({})).find((room) => room.metadata?.game === key);
		const sim = matchMaker.getLocalRoomById(listed.roomId).sim;
		const facts = courseFacts(made);
		const rowBand = (gx) => {
			const y = (gx + made.grid.sourceRows) * CELL;
			return made.bands.find((b) => y >= b.y && y < b.y + b.h);
		};
		const midOf = (gx) => {
			const band = rowBand(gx);
			return {
				x: (band.left + band.right) / 2,
				y: (gx + made.grid.sourceRows) * CELL + CELL / 2,
			};
		};
		const stops = [];
		made.waterfalls.forEach((fall, i) => {
			const gx = Math.round((fall.y + fall.h / 2) / CELL) - made.grid.sourceRows;
			stops.push({ name: `fall${i + 1}-h${fall.height}`, gx: gx + 3, fall });
		});
		facts.across
			.filter((a) => a.cells >= 10)
			.forEach((a, i) =>
				stops.push({ name: `across${i + 1}`, gx: Math.round((a.from + a.to) / 2) }),
			);
		[...facts.turns]
			.sort((a, b) => b.deg - a.deg)
			.slice(0, 3)
			.forEach((t, i) => stops.push({ name: `bend${i + 1}-${t.deg}deg`, gx: t.gx }));
		stops.push({ name: 'source', gx: 3 }, { name: 'mid', gx: 200 }, { name: 'delta', gx: 330 });
		let drawnAll = true;
		for (const stop of stops) {
			Object.assign(sim.players.get(me).body, midOf(stop.gx));
			await settle(2500);
			const st = await state();
			const drawn = st.arcade?.online?.drawn?.find((d) => d.id === me);
			drawnAll &&= !!drawn;
			writeFileSync(join(out, `${seed}-${stop.name}.png`), await page.screenshot());
		}
		result.stops[seed] = stops.map((s) => `${s.name}@${s.gx}`);
		verdict(`seed ${seed}: the salmon is drawn at each of ${stops.length} stops`, drawnAll);

		// The tallest waterfall: from three cells below it, Up + Left held (up the river on the
		// mirrored screen), Space tapped until it is over.
		const tallest = stops.filter((s) => s.fall).sort((a, b) => b.fall.height - a.fall.height)[0];
		if (tallest) {
			const line = tallest.fall.y + tallest.fall.h / 2;
			Object.assign(sim.players.get(me).body, midOf(tallest.gx));
			await settle(1500);
			await key2(['ArrowUp', 'ArrowLeft'], 'down');
			let taps = 0;
			let body;
			let peak = 0;
			for (; taps < 80; taps++) {
				await key2(['Space'], 'down');
				await settle(120);
				await key2(['Space'], 'up');
				await settle(200);
				const st = await state();
				body = st.arcade?.bodies?.find((b) => b.id === me);
				peak = Math.max(peak, sim.players.get(me).z ?? 0);
				if (taps === 6) writeFileSync(join(out, `${seed}-climbing.png`), await page.screenshot());
				if (body && body.y < line - CELL) break;
			}
			await key2(['ArrowUp', 'ArrowLeft'], 'up');
			await settle(1500);
			writeFileSync(join(out, `${seed}-climbed.png`), await page.screenshot());
			verdict(
				`seed ${seed}: its tallest waterfall (${tallest.fall.height} cells) is climbed by tapping Space and swum over`,
				!!body && body.y < line - CELL,
				{ taps, y: body?.y, line, peakCells: peak / CELL },
			);
		}
		const errors = await page.evaluate('window.__AR_ERRORS__').catch(() => []);
		verdict(`seed ${seed}: no page error`, errors.length === 0, { errors });
		await page.close();
	}
} finally {
	server.stop();
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await rooms.close();
	for (const snap of snaps) await snap.close();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts)
	console.log(
		`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}${v.ok ? '' : ` ${JSON.stringify(v.detail)}`}`,
	);
console.log(`  stops: ${JSON.stringify(result.stops)}`);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(
	failed ? `\nsalmons river tour: ${failed} FAILED` : `\nsalmons river tour: OK → ${out}`,
);
process.exit(failed ? 1 : 0);
