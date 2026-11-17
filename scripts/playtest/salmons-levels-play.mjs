// Plays SALMONS ON THE ORIGINAL GAME'S LEVEL (docs/design/salmons-levels.md) in a headless shell
// against a real game server on localhost: the exported config (`salmonsMap`, no pinned seeds), so
// the room picks a random level and the page makes it from the seed the room's state carries. It
// checks: the page made the level the room's seed makes in Node (`generatedOnlineGame`, the server's
// own function), drew it in the original art (one rock and whirlpool per generated one, a waterfall
// face per waterfall, sand), the own salmon swims upstream on ArrowUp, and no page error. It prints
// how long the art took and the page's JS heap, since the original's river is about 2.7× longer and
// 3.8× wider than P10.16's. A second config pins one seed, and its room must play it.
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

import { generatedOnlineGame } from '../../packages/engine-mechanics/src/onlineGenerators.js';
import { salmonsConfig } from '../../packages/engine-mechanics/src/salmons.js';
import {
	SALMONS_MAP_SEED,
	salmonsMapRiver,
} from '../../packages/engine-mechanics/src/salmonsMap.js';
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
const roomsPort = 20000 + Math.floor(Math.random() * 20000);
const rooms = createGameServer({
	loadGame: createConfigSource({ dir: configs }),
	maxRooms: 4,
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
	const key = (name, type) =>
		page.page('Input.dispatchKeyEvent', {
			type: type === 'down' ? 'rawKeyDown' : 'keyUp',
			key: name,
			code: name,
			windowsVirtualKeyCode: { ArrowUp: 38 }[name],
		});
	return { page, state, settle, key, artMs };
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
	await a.settle(6000);
	result.measures.fps = Math.round((((await a.state()).frame - f0) * 1000) / (Date.now() - t0));
	await a.key('ArrowUp', 'up');
	const after = await yOf();
	verdict('ArrowUp swims the salmon upstream', after < before - 100, { before, after });
	writeFileSync(join(out, 'level.png'), await a.page.screenshot());
	const errors = await a.page.evaluate('window.__AR_ERRORS__');
	verdict('no page error', errors.length === 0, errors);
	await a.page.close();

	const p = await boot('p', { rooms_name: 'Pia', rooms_game: 'salmons-pinned' });
	const pSeed = (await p.state()).arcade?.online?.seed;
	verdict('a config that pins a seed: its room plays that level', pSeed === PINNED, {
		seed: pSeed,
	});
	await p.page.close();
} finally {
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await rooms.close();
	await server.close?.();
	await snap.close?.();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts) console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
console.log(`  measures: ${JSON.stringify(result.measures)}`);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(
	failed ? `\nsalmons levels play: ${failed} FAILED` : `\nsalmons levels play: OK → ${out}`,
);
process.exit(failed ? 1 : 0);
