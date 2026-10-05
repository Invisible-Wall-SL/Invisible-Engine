// Current-games regression harness (docs/director/DECISIONS/0004, PLAN 1.3–1.6).
// How to run it and read the report: docs/playtest/current-games.md.
//
//   node scripts/current-games/run.mjs
//     [--base-ref origin/main | --base-build <dir>] [--head-build <dir>]
//     [--games-file <json>] [--manifest-file <json>] [--only k1,k2] [--scenario id,id]
//     [--shard 1/4] [--seed current-games] [--out <dir>] [--cache <dir>]
//     [--no-gates | --gates-file <json>] [--keep-screens] [--trace] [--chrome <exe>]
//
// For every live game: render its PUBLISHED snapshot (read-only from R2) with main's runtime (BASE)
// and the branch's runtime (HEAD), play its game type's screen script
// (`screens/<gameType>.json`) on each with the same seed and forced books, and compare each screen
// under `tolerance.json`. Rows: build / tests / looks the same. Writes `report.json` + `index.html`
// to --out (one shard's part when sharded; `report.mjs merge` joins the parts). Exit 1 when a
// rendered game fails, 2 when the run itself cannot start (a missing secret, a failed build).

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { headlessShell } from '../playtest/headless-shell.mjs';
import { openPage } from './lib/browser.mjs';
import { compareScreens, identical, loadTolerance, toleranceFor } from './lib/compare.mjs';
import { gatesFor, loadGateResults, runGate } from './lib/gates.mjs';
import { fetchManifest, fetchSnapshot, listGames } from './lib/games.mjs';
import { playScenario } from './lib/play.mjs';
import { redactText } from './lib/redact.mjs';
import { writeReport } from './lib/report.mjs';
import { buildWorkingTree, gitSha, runtimeForRef } from './lib/runtimes.mjs';
import { serveSnapshot, startTestServer, testServerTree } from './lib/serve.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const HERE = import.meta.dirname;

const { values: opt } = parseArgs({
	options: {
		'base-ref': { type: 'string', default: 'origin/main' },
		'base-build': { type: 'string' },
		'head-build': { type: 'string' },
		'games-file': { type: 'string' },
		'manifest-file': { type: 'string' },
		only: { type: 'string' },
		scenario: { type: 'string' },
		shard: { type: 'string', default: '1/1' },
		seed: { type: 'string', default: 'current-games' },
		out: { type: 'string', default: join(ROOT, '.cache/current-games/report') },
		cache: { type: 'string', default: join(ROOT, '.cache/current-games') },
		tolerance: { type: 'string', default: join(HERE, 'tolerance.json') },
		'no-gates': { type: 'boolean', default: false },
		'gates-file': { type: 'string' },
		'keep-screens': { type: 'boolean', default: false },
		trace: { type: 'boolean', default: false },
		chrome: { type: 'string' },
	},
});

const log = (...parts) => console.log(`[current-games] ${parts.join(' ')}`);
const started = Date.now();
const out = resolve(opt.out);
const cache = resolve(opt.cache);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'screens'), { recursive: true });

/** Die before rendering anything, with the reason in the report. */
const abort = (raw) => {
	const message = redactText(raw);
	console.error(`[current-games] ${message}`);
	writeFileSync(
		join(out, 'report.json'),
		JSON.stringify({ version: 1, aborted: message, games: [] }, null, '\t'),
	);
	process.exit(2);
};

// ---------- game list + contracts ----------

const [shardIndex, shardCount] = opt.shard.split('/').map(Number);
let games;
let manifest;
try {
	games = await listGames({ gamesFile: opt['games-file'] });
	const needsR2 = games.some((g) => g.publishedPointerKey && !g.local);
	manifest = needsR2 || !opt['games-file'] ? await fetchManifest({}) : {};
	if (opt['manifest-file'])
		manifest = { ...manifest, ...(await fetchManifest({ manifestFile: opt['manifest-file'] })) };
} catch (e) {
	abort(e.message);
}
const only = opt.only ? new Set(opt.only.split(',')) : null;
games = games
	.filter((g) => !only || only.has(g.key))
	.sort((a, b) => a.key.localeCompare(b.key))
	.filter((_g, i) => i % shardCount === shardIndex - 1);
log(`${games.length} game(s) in shard ${opt.shard}`);

// ---------- runtimes ----------

let base;
let head;
const buildStatus = { status: 'pass' };
try {
	base = opt['base-build']
		? { sha: 'local', dir: resolve(opt['base-build']), cached: true }
		: runtimeForRef(ROOT, cache, opt['base-ref']);
	log(`base runtime ${base.sha}${base.cached ? ' (cached)' : ''}: ${base.dir}`);
} catch (e) {
	abort(`base runtime build failed: ${e.message}`);
}
// CI passes the PR head here (GITHUB_SHA is the merge commit there, and is reserved), so a screen's
// id names the commit the status is posted on.
const headSha = process.env.CURRENT_GAMES_HEAD_SHA || gitSha(ROOT, 'HEAD');
try {
	head = {
		sha: headSha,
		dir: opt['head-build'] ? resolve(opt['head-build']) : buildWorkingTree(ROOT, cache),
	};
	log(`head runtime ${headSha}: ${head.dir}`);
} catch (e) {
	buildStatus.status = 'fail';
	buildStatus.detail = e.message;
}

const tolerance = loadTolerance(opt.tolerance);
if (opt['gates-file']) loadGateResults(opt['gates-file']);
const chrome = headlessShell(opt.chrome);

// ---------- per game ----------

const SCRIPT_FOR_KIND = {
	bookOf: 'bookOf',
	holdAndWin: 'holdAndWin',
	ways: 'ways',
	cluster: 'cluster',
	scatter: 'scatter',
};
const scriptFor = (gameType) => SCRIPT_FOR_KIND[gameType] ?? 'lines';
const loadScript = (name) =>
	JSON.parse(readFileSync(join(HERE, 'screens', `${name}.json`), 'utf8'));

/** One side's render of one scenario: `{ shots: {screen: png}, states, error, final }`. */
async function render(side, runtimeDir, game, snapshot, scenario, draw) {
	const tree = testServerTree(
		join(cache, 'trees', `${side}-${game.key}`),
		runtimeDir,
		game.key,
		manifestEntry(game),
	);
	const shots = {};
	const states = {};
	const renderStarted = Date.now();
	let server;
	let snap;
	let profile;
	let page;
	let error;
	let final;
	let consoleLines = [];
	/** Boot the game on the two servers and play the scenario on it. */
	const play = async () => {
		const sid = `cg-${game.key}-${scenario.id}`;
		const rgs = `${server.origin}/api/${game.key}/authoring`;
		const params = new URLSearchParams({
			runtime: '1',
			project: game.projectKey ?? game.key,
			k: 'current-games',
			editorDocBase: snap.origin,
			rgs_url: rgs.replace(/^http:\/\//, ''),
			sessionID: sid,
			lang: 'en',
			currency: 'USD',
			device: 'desktop',
			ie_determinism: opt.seed,
		});
		await page.navigate(`${server.origin}/${game.key}/?${params}`);
		let ready = false;
		for (let i = 0; i < 300 && !ready; i++) {
			ready = await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false);
			if (!ready) await new Promise((r) => setTimeout(r, 100));
		}
		if (!ready) throw new Error('the runtime never installed determinism mode');
		await playScenario(scenario, {
			page,
			draw,
			force: async (spec) => {
				const beat = fillBeat(spec, manifestEntry(game));
				const res = await fetch(
					`${rgs}/force?sid=${encodeURIComponent(sid)}&beat=${encodeURIComponent(beat)}`,
					{ method: 'POST' },
				);
				if (!res.ok) throw new Error(`force ${beat}: HTTP ${res.status} ${await res.text()}`);
			},
			trace: opt.trace
				? (i, op, s) =>
						log(
							`  ${side} ${scenario.id} #${i + 1} ${op.op} → frame ${s.frame} idle ${s.idle} ` +
								`win ${s.win} tier ${s.winLevel ?? '-'} [${s.screens.join('>')}]`,
						)
				: undefined,
			capture: async (screen, state) => {
				shots[screen] = await page.screenshot();
				states[screen] = { frame: state.frame, screens: state.screens, winLevel: state.winLevel };
			},
		});
	};
	try {
		server = await startTestServer(tree, { SEED: opt.seed, ...(scenario.env ?? {}) });
		snap = await serveSnapshot({
			dir: snapshot.dir,
			name: game.name,
			snapshotId: snapshot.id,
			assetBase: game.local?.assetBase === 'runtime' ? `${server.origin}/${game.key}/` : undefined,
		});
		profile = mkdtempSync(join(tmpdir(), 'cg-profile-'));
		page = await openPage(chrome, profile);
		await play();
	} catch (e) {
		error = e.message;
	} finally {
		final = await page
			?.evaluate(
				'window.__IE_DETERMINISM__ && { ...window.__IE_DETERMINISM__.state(), renderer: window.__PIXI_APP__?.renderer?.name }',
			)
			.catch(() => undefined);
		consoleLines = [...(page?.consoleLines ?? [])];
		await page?.close();
		server?.stop();
		await snap?.close();
		if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
	}
	return {
		shots,
		states,
		error,
		final,
		console: consoleLines,
		seconds: (Date.now() - renderStarted) / 1000,
	};
}

/** The game's mock contract: a fixture's own entry, else its test-server manifest entry. */
function manifestEntry(game) {
	return (
		game.local?.manifestEntry ??
		manifest[game.key] ?? { protocol: protocolFor(game.gameType), name: game.name }
	);
}

function protocolFor(gameType) {
	if (gameType === 'bookOf') return 'book';
	return ['ways', 'cluster', 'scatter', 'holdAndWin'].includes(gameType) ? gameType : 'lines';
}

const safe = (s) => s.replace(/[^\w.-]/g, '_');

/** The id half for a screen only one side captured: the side plus that capture's bytes. */
const oneSidedHash = (png, side) =>
	createHash('sha256').update(side).update(png).digest('hex').slice(0, 16);

/** `grid.potsOverlay.pots.0.id` in a manifest entry; a negative index counts from the end. */
const at = (value, path) =>
	path.split('.').reduce((v, key) => {
		if (v === undefined || v === null) return undefined;
		const i = Number(key);
		return Array.isArray(v) && Number.isInteger(i) ? v.at(i) : v[key];
	}, value);

/** A forced beat with `{path}` placeholders filled from the game's contract (its own pot ids…). */
const fillBeat = (beat, entry) =>
	beat.replace(/\{([\w.-]+)\}/g, (_m, path) => {
		const v = at(entry, path);
		if (v === undefined) throw new Error(`force "${beat}": the contract has no ${path}`);
		return String(v);
	});

async function runGame(game) {
	const row = {
		key: game.key,
		name: game.name,
		gameType: game.gameType,
		projectKey: game.projectKey,
		hasOwnBuiltBundle: Boolean(game.hasOwnBuiltBundle),
		build: buildStatus,
		tests: { status: 'skip', gates: [] },
		looks: { status: 'skip' },
		screens: [],
		notes: [],
	};
	const script = scriptFor(game.gameType);
	row.script = script;
	if (!opt['no-gates']) {
		row.tests.gates = gatesFor(script).map(runGate);
		row.tests.status = row.tests.gates.every((g) => g.pass) ? 'pass' : 'fail';
	}

	if (game.hasOwnBuiltBundle) {
		row.looks = { status: 'own-bundle' };
		row.notes.push(
			'Desktop-built game: it serves its own bundle, which is the same bundle on both sides, so ' +
				'it is not rendered; only build and tests are checked against the branch.',
		);
		return row;
	}
	if (!game.publishedPointerKey && !game.local) {
		row.looks = { status: 'no-snapshot' };
		row.notes.push('not rendered (no snapshot): a global game has no published snapshot.');
		return row;
	}
	if (buildStatus.status !== 'pass') {
		row.looks = { status: 'error', detail: 'the branch runtime did not build' };
		return row;
	}
	let snapshot;
	try {
		snapshot = await fetchSnapshot(game, cache);
	} catch (e) {
		row.looks = { status: 'error', detail: `snapshot fetch failed: ${e.message}` };
		return row;
	}
	if (!snapshot) {
		row.looks = { status: 'unpublished' };
		row.notes.push('skip: not published (its published pointer does not exist).');
		return row;
	}
	row.snapshot = snapshot.id;

	const screensFile = loadScript(script);
	const smoke = { status: 'pass', errors: 0, stalls: 0, failures: [] };
	// main itself failing a scenario is not the branch's doing: reported, but as main's.
	const baseFailures = [];
	const entry = manifestEntry(game);
	const scenarios = screensFile.scenarios.filter(
		(sc) => !opt.scenario || opt.scenario.split(',').includes(sc.id),
	);
	// A scenario for a feature this game does not have (`requires`: contract paths) is not played.
	const skipped = scenarios.filter((sc) => (sc.requires ?? []).some((p) => !at(entry, p)));
	if (skipped.length)
		row.notes.push(
			`scenario(s) not played, the game has no such feature: ${skipped.map((sc) => sc.id).join(', ')}`,
		);
	for (const scenario of scenarios.filter((sc) => !skipped.includes(sc))) {
		const draw = scenario.canary ? 'every' : 'last';
		log(`${game.key} · ${scenario.id} (${draw})`);
		const sides = {};
		for (const [side, runtime] of [
			['base', base],
			['head', head],
		])
			sides[side] = await render(side, runtime.dir, game, snapshot, scenario, draw);
		row.timings = {
			...row.timings,
			[scenario.id]: { base: sides.base.seconds, head: sides.head.seconds },
		};
		for (const [side, r] of Object.entries(sides)) {
			// Players render with WebGL; a page that fell back to Pixi's Canvas renderer (no WebGL in
			// the browser) draws through other code and proves nothing about theirs.
			if (r.final?.renderer && r.final.renderer !== 'webgl' && !r.error)
				r.error = `the page rendered with Pixi's ${r.final.renderer} renderer, not WebGL`;
			const errors = r.final?.errors ?? 0;
			const stalls = r.final?.stalls ?? 0;
			if (!r.error && !errors && !stalls) continue;
			const failure = {
				side,
				scenario: scenario.id,
				error: r.error,
				errors,
				stalls,
				console: r.console.slice(-10),
			};
			if (side === 'base') baseFailures.push(failure);
			else {
				smoke.errors += errors;
				smoke.stalls += stalls;
				smoke.failures.push(failure);
			}
		}
		const screens = [
			...new Set([...Object.keys(sides.base.shots), ...Object.keys(sides.head.shots)]),
		];
		for (const screen of screens) {
			const tol = toleranceFor(tolerance, script, screen);
			const before = sides.base.shots[screen];
			const after = sides.head.shots[screen];
			const shot = {
				screen,
				scenario: scenario.id,
				draw,
				tolerance: tol,
				state: { base: sides.base.states[screen], head: sides.head.states[screen] },
			};
			const stem = `${safe(game.key)}--${safe(screen)}`;
			if (!before || !after) {
				shot.pass = false;
				shot.reason = `captured on ${before ? 'main' : 'the branch'} only — no diff`;
				shot.diffHash = oneSidedHash(before ?? after, before ? 'base' : 'head');
			} else if (identical(before, after)) {
				shot.pass = true;
				shot.identical = true;
				shot.measured = { diffPixels: 0, diffRatio: 0, maxBlockRatio: 0 };
			} else {
				const c = compareScreens(before, after, tol);
				shot.pass = c.pass;
				shot.reason = c.reason;
				shot.measured = {
					diffPixels: c.diffPixels,
					diffRatio: c.diffRatio,
					maxBlockRatio: c.maxBlockRatio,
					box: c.box,
				};
				shot.diffHash = c.diffHash;
				if (c.diffPng) {
					writeFileSync(join(out, 'screens', `${stem}.diff.png`), c.diffPng);
					shot.images = { diff: `screens/${stem}.diff.png` };
				}
			}
			if (shot.diffHash) shot.id = `${headSha}:${game.key}:${screen}:${shot.diffHash}`;
			if (!shot.pass || opt['keep-screens']) {
				for (const [side, png] of [
					['before', before],
					['after', after],
				])
					if (png) {
						writeFileSync(join(out, 'screens', `${stem}.${side}.png`), png);
						shot.images = { ...shot.images, [side]: `screens/${stem}.${side}.png` };
					}
			}
			row.screens.push(shot);
		}
	}
	if (smoke.failures.length) smoke.status = 'fail';
	row.tests.smoke = smoke;
	if (smoke.status === 'fail') row.tests.status = 'fail';
	else if (row.tests.status === 'skip') row.tests.status = 'pass';
	const changed = row.screens.filter((s) => !s.pass);
	row.looks = baseFailures.length
		? {
				status: 'error',
				detail: `main's runtime failed this game too, so the comparison proves nothing: ${baseFailures
					.map((f) => `${f.scenario}: ${f.error ?? `errors ${f.errors}, stalls ${f.stalls}`}`)
					.join('; ')}`,
				baseFailures,
				changed: changed.length,
				of: row.screens.length,
			}
		: changed.length
			? { status: 'changed', changed: changed.length, of: row.screens.length }
			: { status: 'same', of: row.screens.length };
	return row;
}

const rows = [];
for (const game of games) {
	try {
		rows.push(await runGame(game));
	} catch (e) {
		rows.push({
			key: game.key,
			name: game.name,
			gameType: game.gameType,
			build: buildStatus,
			tests: { status: 'skip', gates: [] },
			looks: { status: 'error', detail: e.message },
			screens: [],
			notes: [],
		});
	}
}

const report = writeReport(out, {
	version: 1,
	head: { sha: headSha, ref: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || null },
	base: { sha: base.sha, ref: opt['base-build'] ? null : opt['base-ref'] },
	seed: opt.seed,
	viewport: '1280x720@1 UTC en-US',
	shard: opt.shard,
	startedAt: new Date(started).toISOString(),
	seconds: Math.round((Date.now() - started) / 1000),
	games: rows,
});
log(`${report.summary.verdict} — ${join(out, 'index.html')}`);
process.exit(report.summary.verdict === 'pass' ? 0 : 1);
