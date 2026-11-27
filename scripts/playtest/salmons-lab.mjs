// The SALMONS lab run (Salmons performance plan T2, docs/design/salmons-performance.md): the
// deterministic before/after harness the performance tracks measure against. It boots Salmons as a
// player does, on the real frame clock with `?perf=1` and no determinism flag: a local game server
// (`services/game-server`) and the built runtime, the export's own config (the original game's
// level, bots by shares), a test room of `--bots + 1` places, the level pinned to one seed. The
// page joins as a salmon, waits for the room to run, plays `lab-sequence.mjs`'s scripted input loop
// for `--seconds`, and takes the probe's reading.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/salmons-lab.mjs [--runtime apps/lines/build] [--out <dir>] [--chrome <exe>] \
//     [--bots 20] [--seconds 60] [--runs 1] [--seed 31337] [--character salmon] [--compare <json>]
//
// The runtime is `PUBLIC_IE_FAMILIES=arcade pnpm --filter lines build` (any build that plays arcade).
// Output, per run n: <out>/salmons-lab.<n>.report.json (the play reading), `.mount.report.json`
// (boot to the room running: the level mount), and <out>/salmons-lab.json: the counters of every
// run side by side, with their spread when `--runs` is more than one. Counters are the comparison;
// headless timings (fps, p95) on a shared machine are not.
//
// `--compare scripts/playtest/fixtures/salmons-lab-baseline.json` prints each counter beside the
// baseline's mean and range (a track's before / after) and marks the ones outside that range.
//
// Exit 1 when a run failed.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
	SALMONS_MAP_SEED,
	salmonsMapRiver,
} from '../../packages/engine-mechanics/src/salmonsMap.js';
import { salmonsConfig } from '../../packages/engine-mechanics/src/salmons.js';
import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { SALMONS_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import { normalizeGameConfigDoc } from '../../packages/game-config/index.ts';
import { createConfigSource } from '../../services/game-server/src/configSource.ts';
import { createGameServer } from '../../services/game-server/src/server.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';
import { LAB_WS_HOOK, playArcadeLabSequence } from './lab-sequence.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/salmons-lab') },
		chrome: { type: 'string' },
		bots: { type: 'string', default: '20' },
		seconds: { type: 'string', default: '60' },
		runs: { type: 'string', default: '1' },
		seed: { type: 'string', default: '31337' },
		character: { type: 'string', default: 'salmon' },
		compare: { type: 'string' },
	},
});
const BOTS = Number(opt.bots);
const SEED = Number(opt.seed);
const RUNS = Number(opt.runs);
const SECONDS = Number(opt.seconds);
if (![BOTS, SEED, RUNS, SECONDS].every(Number.isInteger) || BOTS < 2 || RUNS < 1) {
	console.error('--bots (2 or more), --seed, --runs and --seconds are whole numbers');
	process.exit(2);
}
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const CHROME = headlessShell(opt.chrome);
const KEY = 'salmons';

// What the export ships: the original game's level and bots by shares. The room is a test room of
// BOTS + 1 places (`room_size`), which the bots fill but for the one the page takes, and its level
// is pinned: the same river every run.
const river = salmonsMapRiver(SALMONS_MAP_SEED);
const authored = salmonsConfig(river);
authored.arcade.online.levels = { seeds: [SEED] };
// A closed page leaves at once: its room is gone before the next run joins another.
authored.arcade.online.rejoinSeconds = 0;
const config = normalizeGameConfigDoc(authored);
const doc = salmonsReferenceLayout(river);
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...SALMONS_CHARACTER_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const work = mkdtempSync(join(tmpdir(), 'salmons-lab-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({ doc, componentDefs, componentDefaults: {}, config, flowV2: SALMONS_SEED_DOC }),
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
	snapshotId: 'salmons-lab',
	assetBase: `${server.origin}/${KEY}/`,
});
const roomsPort = 20000 + Math.floor(Math.random() * 20000);
const rooms = createGameServer({
	loadGame: createConfigSource({ dir: configs }),
	maxRooms: 16,
	commit: 'salmons-lab',
	gracefullyShutdown: false,
});
await rooms.listen(roomsPort);

/** The local browser as the arcade lab sequence drives it: the Playwright `Page` calls it makes. */
const CODES = {
	ArrowLeft: 37,
	ArrowUp: 38,
	ArrowRight: 39,
	ArrowDown: 40,
	Space: 32,
};
async function openLabPage(profile) {
	const page = await openPage(CHROME, profile);
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: LAB_WS_HOOK });
	const key = (type, name) =>
		page.page('Input.dispatchKeyEvent', {
			type,
			key: name === 'Space' ? ' ' : name,
			code: name,
			windowsVirtualKeyCode: CODES[name],
			nativeVirtualKeyCode: CODES[name],
		});
	return {
		goto: (url) => page.navigate(url),
		evaluate: page.evaluate,
		keyboard: {
			down: (name) => key('rawKeyDown', name),
			up: (name) => key('keyUp', name),
			press: async (name) => {
				await key('rawKeyDown', name);
				await key('keyUp', name);
			},
		},
		consoleLines: page.consoleLines,
		close: () => page.close(),
	};
}

/** The counters a run is compared on: the play reading's per-frame means, the socket per second. */
const COUNTERS = [
	'draws',
	'vertices',
	'passes',
	'targetSwitches',
	'filterPasses',
	'invalidations',
	'created',
	'createdSprites',
	'createdGraphics',
	'createdMeshes',
	'destroyed',
	'textureUploads',
	'calls',
	'jsMs',
	'renderMs',
	'tickMs',
	'uploadBytes',
	'simCatchUp',
	'simDroppedMs',
	'simMs',
	'netMs',
	'bodies',
	'spawns',
	'despawns',
];
/** The phase an arcade reading's frames are in: `play` (probe 8 and later; earlier probes: `idle`). */
const playPhase = (report) => (report.work?.play?.frames ? 'play' : 'idle');

function counters(report, ws, seconds) {
	const phase = playPhase(report);
	const work = report.work[phase];
	const c = {
		phase,
		frames: work.frames,
		// Headless timings, here for the record: counters are what runs are compared on.
		fps: report[phase]?.fps ?? null,
		frameP95Ms: report[phase]?.p95 ?? null,
	};
	for (const key of COUNTERS) c[key] = work.perFrame[key]?.mean ?? null;
	for (const key of ['draws', 'passes', 'invalidations', 'created', 'jsMs', 'renderMs'])
		c[`${key}Max`] = work.perFrame[key]?.max ?? null;
	const sum = (dir, field) =>
		Object.values(ws?.[dir] ?? {}).reduce((n, entry) => n + entry[field], 0);
	c.socket = {
		inMessagesPerSec: round(sum('in', 'messages') / seconds),
		inBytesPerSec: round(sum('in', 'bytes') / seconds),
		outMessagesPerSec: round(sum('out', 'messages') / seconds),
		outBytesPerSec: round(sum('out', 'bytes') / seconds),
		byCode: ws,
	};
	return c;
}
const round = (n) => Math.round(n * 10) / 10;

/** The level mount, from the reading taken as it finished (boot to the mount, every phase): each
 *  count its largest frame. */
const MOUNT = [
	'created',
	'createdSprites',
	'createdGraphics',
	'createdMeshes',
	'uploadBytes',
	'textureUploads',
	'jsMs',
	'renderMs',
];
function mountCounters(report) {
	const phases = Object.values(report.work).filter((w) => w.frames > 0);
	const most = (key) => Math.max(0, ...phases.map((w) => w.perFrame[key]?.max ?? 0));
	return {
		frames: phases.reduce((n, w) => n + w.frames, 0),
		...Object.fromEntries(MOUNT.map((key) => [key, most(key)])),
		textureMb: round(
			(report.textures ?? []).reduce((sum, t) => sum + (typeof t.mb === 'number' ? t.mb : 0), 0),
		),
	};
}

async function playOne(n) {
	const result = { run: n, ok: false };
	const profile = join(work, `profile-${n}`);
	let page;
	try {
		page = await openLabPage(profile);
		const params = new URLSearchParams({
			runtime: '1',
			project: KEY,
			k: 'salmons-lab',
			editorDocBase: snap.origin,
			lang: 'en',
			currency: 'USD',
			device: 'desktop',
			perf: '1',
			rooms_url: `ws://127.0.0.1:${roomsPort}`,
			room_size: String(BOTS + 1),
			rooms_character: opt.character,
			rooms_name: 'Lab',
		});
		await page.goto(`${server.origin}/${KEY}/?${params}`);
		const played = await playArcadeLabSequence(page, {
			playSeconds: SECONDS,
			log: (line) => console.log(`  run ${n}: ${line}`),
		});
		writeFileSync(join(out, `salmons-lab.${n}.mount.report.json`), played.mount);
		writeFileSync(join(out, `salmons-lab.${n}.report.json`), played.text);
		const report = JSON.parse(played.text);
		result.counters = counters(report, played.ws, SECONDS);
		result.mount = mountCounters(JSON.parse(played.mount));
		result.seen = played.run;
		result.ok = true;
	} catch (e) {
		result.error = e instanceof Error ? e.message : String(e);
		if (page) result.console = page.consoleLines.slice(-10);
	} finally {
		await page?.close().catch(() => undefined);
	}
	return result;
}

const results = [];
try {
	for (let n = 1; n <= RUNS; n++) results.push(await playOne(n));
} finally {
	await rooms.close().catch(() => undefined);
	server.stop();
	await snap.close();
	rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}

const flat = (r) => ({
	...Object.fromEntries(COUNTERS.map((k) => [k, r.counters[k]])),
	frames: r.counters.frames,
	jsMsMax: r.counters.jsMsMax,
	inMessagesPerSec: r.counters.socket.inMessagesPerSec,
	inBytesPerSec: r.counters.socket.inBytesPerSec,
	outMessagesPerSec: r.counters.socket.outMessagesPerSec,
	outBytesPerSec: r.counters.socket.outBytesPerSec,
	...Object.fromEntries(Object.entries(r.mount).map(([k, v]) => [`mount.${k}`, v])),
});
const done = results.filter((r) => r.ok);
const spread = {};
for (const key of Object.keys(done[0] ? flat(done[0]) : {})) {
	const values = done.map((r) => flat(r)[key]).filter((v) => typeof v === 'number');
	if (!values.length) continue;
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const min = Math.min(...values);
	const max = Math.max(...values);
	spread[key] = {
		min: round(min),
		mean: round(mean),
		max: round(max),
		rangePct: mean ? round(((max - min) / mean) * 100) : 0,
	};
}
const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
const summary = {
	game: KEY,
	bots: BOTS,
	seed: SEED,
	seconds: SECONDS,
	character: opt.character,
	source: head.status === 0 ? head.stdout.trim() : null,
	chrome: CHROME.split('/').slice(-3).join('/'),
	recordedAt: new Date().toISOString(),
	runs: results,
	spread,
};
writeFileSync(join(out, 'salmons-lab.json'), JSON.stringify(summary, null, '\t'));
for (const r of results) console.log(r.ok ? `PASS run ${r.run}` : `FAIL run ${r.run} — ${r.error}`);

const baseline = opt.compare ? JSON.parse(readFileSync(resolve(opt.compare), 'utf8')) : null;
if (baseline)
	for (const key of ['bots', 'seed', 'seconds', 'character'])
		if (baseline[key] !== summary[key])
			console.log(
				`! baseline ${key} ${baseline[key]}, this run ${summary[key]}: the comparison is not like for like`,
			);
const header = ['counter', 'min', 'mean', 'max', 'range %'];
if (baseline) header.push('baseline mean', 'baseline range', 'vs baseline');
console.log(header.map((h, i) => (i ? h.padStart(14) : h.padEnd(24))).join(' '));
for (const [key, v] of Object.entries(spread)) {
	const cells = [v.min, v.mean, v.max, v.rangePct];
	const was = baseline?.spread?.[key];
	if (baseline)
		cells.push(
			was ? was.mean : '—',
			was ? `${was.min}–${was.max}` : '—',
			!was ? '' : v.mean < was.min ? 'below' : v.mean > was.max ? 'ABOVE' : 'within',
		);
	console.log(`${key.padEnd(24)} ${cells.map((x) => String(x).padStart(14)).join(' ')}`);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
