// Measures what SALMONS loads at boot, on a phone-class page (390 × 844, a phone's user agent
// and touch, device scale factor 3, or `--dpr`), in the headless shell on the real clock against a
// real game server on localhost: the profiler's own report (`?perf=1`, `window.__IE_PERF__`) after
// the page has joined its room and played a while — transfer bytes by class, the boot and
// first-frame times, the GPU textures and which stock files they are, and the quality ladder —
// plus the `[stock-assets]` / `[sound]` console lines, the console's warnings, and a frame every
// 250 ms from the navigation, so a person can see what is on screen while the river builds
// (docs/design/salmons-performance.md T3). It prints numbers only, no verdict; run it on two
// builds to compare them.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/arcade-boot-probe.mjs --runtime apps/lines/build --out <dir> \
//     [--runs 2] [--frames 40] [--play 15] [--dpr 3] [--size 390x844] [--throttle <n>] [--round <s>] \
//     [--chrome <exe>]
//
// `--dpr 1 --round 20 --play 120` plays several rounds: the quality ladder
// measures each round and switches in the 5 s between them.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
	SALMONS_LEVELS,
	SALMONS_LOBBY,
	salmonsConfig,
} from '../../packages/engine-mechanics/src/salmons.js';
import {
	SALMONS_MAP_SEED,
	levelShape,
	salmonsMapRiver,
} from '../../packages/engine-mechanics/src/salmonsMap.js';
import {
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import { SALMONS_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import { normalizeGameConfigDoc } from '../../packages/game-config/index.ts';
import { createConfigSource } from '../../services/game-server/src/configSource.ts';
import { createGameServer } from '../../services/game-server/src/server.ts';
import { openPage } from '../current-games/lib/browser.mjs';
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
		out: { type: 'string', default: join(ROOT, '.cache/arcade-boot-probe') },
		chrome: { type: 'string' },
		runs: { type: 'string', default: '2' },
		frames: { type: 'string', default: '40' },
		play: { type: 'string', default: '15' },
		throttle: { type: 'string' },
		round: { type: 'string' },
		dpr: { type: 'string', default: '3' },
		size: { type: 'string', default: '390x844' },
	},
});
const out = resolve(opt.out);
if (!/^\d+x\d+$/.test(opt.size)) {
	console.error(`--size is WIDTHxHEIGHT in CSS px (e.g. 390x844), not "${opt.size}"`);
	process.exit(2);
}
const [WIDTH, HEIGHT] = opt.size.split('x').map(Number);
mkdirSync(out, { recursive: true });
const KEY = 'salmons';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The game as `scripts/salmons/export.mjs` writes it: the original's levels, its lobby and bots.
const river = salmonsMapRiver(SALMONS_MAP_SEED, undefined, levelShape(SALMONS_LEVELS));
const authored = salmonsConfig(river, { lobby: SALMONS_LOBBY, levels: SALMONS_LEVELS });
// No lobby wait: the page plays at once.
authored.arcade.online.rules.lobby = undefined;
// `--round <s>`: rounds of that length with 5 s between them, so a slow run has quiet moments.
if (opt.round)
	authored.arcade.online.rules.round = { seconds: Number(opt.round), nextRoundSeconds: 5 };
const config = normalizeGameConfigDoc(authored);
const doc = salmonsReferenceLayout(river);
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...SALMONS_CHARACTER_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const work = mkdtempSync(join(tmpdir(), 'arcade-boot-probe-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config,
		flowV2: SALMONS_SEED_DOC,
		// What a publish ships: Salmons' data names no stock sound (`soundReachability.ts`).
		sounds: { catalog: { prefix: 'sounds', sounds: [], stock: { version: 1, names: [] } } },
	}),
);
const configs = join(work, 'configs');
mkdirSync(configs);
writeFileSync(join(configs, `${KEY}.json`), JSON.stringify(config));

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
	commit: 'probe',
	gracefullyShutdown: false,
});
await rooms.listen(roomsPort);

const PHONE_UA =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const CONSOLE = `(() => {
	const lines = (window.__PROBE_LOG__ = []);
	const info = console.info.bind(console);
	console.info = (...args) => { lines.push(args.map(String).join(' ')); info(...args); };
	const warn = console.warn.bind(console);
	console.warn = (...args) => { lines.push('warn: ' + args.map(String).join(' ')); warn(...args); };
})();`;

const sum = (list, field) => list.reduce((total, item) => total + (item[field] ?? 0), 0);
const mb = (bytes) => Math.round((bytes / 1e6) * 100) / 100;

async function run(index) {
	const page = await openPage(headlessShell(opt.chrome), join(work, `profile-${index}`));
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: CONSOLE });
	await page.page('Emulation.setDeviceMetricsOverride', {
		width: WIDTH,
		height: HEIGHT,
		deviceScaleFactor: Number(opt.dpr),
		mobile: true,
	});
	await page.page('Emulation.setUserAgentOverride', { userAgent: PHONE_UA });
	await page.page('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	// `--throttle <n>`: the CPU n times slower, a phone that cannot hold 60 fps.
	if (opt.throttle)
		await page.page('Emulation.setCPUThrottlingRate', { rate: Number(opt.throttle) });
	const params = new URLSearchParams({
		runtime: '1',
		project: KEY,
		k: 'boot-probe',
		editorDocBase: snap.origin,
		lang: 'en',
		currency: 'USD',
		perf: '1',
		rooms_url: `ws://127.0.0.1:${roomsPort}`,
		rooms_character: 'salmon',
	});
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	const shots = join(out, `run${index}`);
	mkdirSync(shots, { recursive: true });
	for (let i = 0; i < Number(opt.frames); i++) {
		await wait(250);
		writeFileSync(
			join(shots, `t${String(i * 250).padStart(5, '0')}.png`),
			await page.screenshot().catch(() => Buffer.alloc(0)),
		);
		// The loading screen's tap to start, while it is up.
		if (i % 8 === 7)
			await page.page('Input.dispatchTouchEvent', {
				type: 'touchStart',
				touchPoints: [{ x: WIDTH / 2, y: HEIGHT * 0.7 }],
			});
		if (i % 8 === 7)
			await page.page('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	}
	await wait(Number(opt.play) * 1000);
	writeFileSync(join(shots, 'played.png'), await page.screenshot());
	const text = await page.evaluate('window.__IE_PERF__ ? window.__IE_PERF__() : null');
	const log = await page.evaluate('JSON.stringify(window.__PROBE_LOG__ ?? [])');
	await page.close();
	if (!text) throw new Error('no profiler on the page (`?perf=1`)');
	const report = JSON.parse(text);
	writeFileSync(join(out, `run${index}.report.json`), text);
	const textures = report.textureList ?? [];
	const loaded = textures.filter((t) => t.kind !== 'target' && t.kind !== 'canvas');
	const stock = loaded.filter(
		(t) => t.src && !t.src.startsWith('_pages/') && !t.src.includes('/'),
	).length;
	const net = report.network;
	return {
		transferMB: mb(net.totals.transfer),
		byClassMB: Object.fromEntries(Object.entries(net.byClass).map(([k, v]) => [k, mb(v.transfer)])),
		files: net.totals.files,
		firstFrameMs: net.firstFrameMs,
		bootMs: net.bootMs,
		gpuTextureMB: Math.round(sum(textures, 'mb') * 100) / 100,
		gpuLoadedMB: Math.round(sum(loaded, 'mb') * 100) / 100,
		loadedTextures: loaded.map((t) => `${t.src} ${t.mb}`),
		unscopedTextures: stock,
		audio: net.files.filter((f) => f.class === 'audio').map((f) => f.path.split('/').pop()),
		quality: report.quality,
		tier: report.tier,
		log: JSON.parse(log).filter((line) => /^\[stock-|^\[sound\]/.test(line)),
		warnings: JSON.parse(log).filter((line) => line.startsWith('warn: ')),
	};
}

const results = [];
for (let i = 0; i < Number(opt.runs); i++) results.push(await run(i));
writeFileSync(join(out, 'result.json'), JSON.stringify(results, null, '\t'));
for (const [i, r] of results.entries()) {
	console.log(
		`run ${i}: transfer ${r.transferMB} MB (${JSON.stringify(r.byClassMB)}), ${r.files} files, ` +
			`firstFrame ${r.firstFrameMs} ms, boot ${r.bootMs} ms, GPU textures ${r.gpuTextureMB} MB ` +
			`(loaded ${r.gpuLoadedMB} MB), tier ${r.tier}`,
	);
}
console.log(
	JSON.stringify(
		{
			log: results[0].log,
			warnings: results[0].warnings,
			audio: results[0].audio,
			quality: results[0].quality,
		},
		null,
		1,
	),
);
console.log(results[0].loadedTextures.join('\n'));
console.log(`arcade boot probe → ${out}`);

await rooms.gracefullyShutdown?.(false).catch(() => {});
await matchMaker.gracefullyShutdown?.().catch(() => {});
server.stop();
await snap.close();
rmSync(work, { recursive: true, force: true });
process.exit(0);
