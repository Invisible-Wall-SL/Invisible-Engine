// Current-games regression harness (docs/director/DECISIONS/0004, PLAN 1.3–1.6).
// How to run it and read the report: docs/playtest/current-games.md.
//
//   node scripts/current-games/run.mjs
//     [--base-ref origin/main | --base-build <dir>] [--head-build <dir>]
//     [--games-file <json>] [--manifest-file <json>] [--only k1,k2] [--scenario id,id]
//     [--seed current-games] [--out <dir>] [--cache <dir>] [--jobs 2]
//     [--no-gates | --gates-file <json>] [--keep-screens] [--trace] [--chrome <exe>]
//     [--phase all | plan | render | compare] [--plan <json>] [--shard 1/4] [--units <dir>,…]
//
// For every live game: render its PUBLISHED snapshot (read-only from R2) with main's runtime (BASE)
// and the branch's runtime (HEAD), play its game type's screen script (`screens/<gameType>.json`)
// on each with the same seed and forced books, and compare each screen under `tolerance.json`.
// Rows: build / tests / looks the same. Writes `report.json` + `index.html` (+ `summary.txt`,
// `digest.txt`) to --out.
//
// Phases. `all` (the default, a local run) does everything in one process. CI splits it:
//   plan     list the games, pin each one's snapshot, list the render units → `<out>/plan.json`
//   render   render this shard's units (`--plan`, `--shard i/n`) → `<out>/units/<id>/`
//   compare  pair the units of every shard (`--units`), compare, write the report
// A unit is one side of one scenario of one game; the two sides of a comparison are independent
// renders (fresh test server, fresh browser), so they need not share a runner.
// Exit 1 when a rendered game fails, 2 when the run itself cannot start.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { headlessShell } from '../playtest/headless-shell.mjs';
import { assembleReport } from './lib/assemble.mjs';
import { loadTolerance } from './lib/compare.mjs';
import { loadGateResults } from './lib/gates.mjs';
import { fetchManifest, fetchSnapshot, listGames } from './lib/games.mjs';
import { makePlan, unitsForShard } from './lib/plan.mjs';
import { redactText } from './lib/redact.mjs';
import { renderUnit } from './lib/render.mjs';
import { writeSummaryFiles } from './lib/report.mjs';
import { buildWorkingTree, gitSha, runtimeForRef } from './lib/runtimes.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const HERE = import.meta.dirname;

const { values: opt } = parseArgs({
	options: {
		phase: { type: 'string', default: 'all' },
		plan: { type: 'string' },
		units: { type: 'string' },
		'base-ref': { type: 'string', default: 'origin/main' },
		'base-build': { type: 'string' },
		'head-build': { type: 'string' },
		'games-file': { type: 'string' },
		'manifest-file': { type: 'string' },
		only: { type: 'string' },
		scenario: { type: 'string' },
		shard: { type: 'string', default: '1/1' },
		jobs: { type: 'string', default: '2' },
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

const PHASES = ['all', 'plan', 'render', 'compare'];
if (!PHASES.includes(opt.phase)) {
	console.error(`--phase must be one of ${PHASES.join(', ')}`);
	process.exit(2);
}
const log = (...parts) => console.log(`[current-games] ${parts.join(' ')}`);
const started = Date.now();
const out = resolve(opt.out);
const cache = resolve(opt.cache);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/** Die before rendering anything, with the reason in the report. */
const abort = (raw) => {
	const message = redactText(raw);
	console.error(`[current-games] ${message}`);
	const report = assembleReport({
		plan: { aborted: message, games: [] },
		unitDirs: [],
		out,
		tolerance: {},
	});
	writeSummaryFiles(out, report);
	// The plan phase's output is what every later job reads: it carries the reason too.
	if (opt.phase === 'plan')
		writeFileSync(
			join(out, 'plan.json'),
			JSON.stringify({ version: 2, aborted: message, games: [] }),
		);
	process.exit(2);
};

// CI passes the PR head here (GITHUB_SHA is the merge commit there, and is reserved), so a screen's
// id names the commit the status is posted on.
const headSha = process.env.CURRENT_GAMES_HEAD_SHA || gitSha(ROOT, 'HEAD');

/** List the games, pin each one's snapshot, list the units. */
async function plan() {
	try {
		const games = await listGames({ gamesFile: opt['games-file'] });
		const needsR2 = games.some((g) => g.publishedPointerKey && !g.local);
		let manifest = needsR2 || !opt['games-file'] ? await fetchManifest({}) : {};
		if (opt['manifest-file'])
			manifest = { ...manifest, ...(await fetchManifest({ manifestFile: opt['manifest-file'] })) };
		const made = await makePlan({
			games,
			manifest,
			only: opt.only ? new Set(opt.only.split(',')) : null,
			scenarioIds: opt.scenario?.split(','),
		});
		const baseSha = process.env.CURRENT_GAMES_BASE_SHA;
		return {
			version: 2,
			seed: opt.seed,
			head: { sha: headSha },
			base: baseSha ? { sha: baseSha } : undefined,
			...made,
		};
	} catch (e) {
		abort(e.message);
	}
}

/** A unit that never rendered still writes a result, so the compare names why. */
function writeFailedUnit(unit, error) {
	const dir = join(out, 'units', unit.id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'result.json'),
		JSON.stringify({
			unit,
			screens: {},
			error: redactText(error),
			errors: 0,
			stalls: 0,
			console: [],
			seconds: 0,
		}),
	);
}

/** Render `units` of `thePlan`, `--jobs` at a time. */
async function render(thePlan, units, runtimes) {
	const chrome = headlessShell(opt.chrome);
	const byKey = new Map(thePlan.games.map((p) => [p.game.key, p]));
	// One download per snapshot, however many of the game's units run at once.
	const snapshots = new Map();
	const snapshotOf = (planned) => {
		if (!snapshots.has(planned.game.key))
			snapshots.set(planned.game.key, fetchSnapshot(planned.game, cache, planned.snapshot));
		return snapshots.get(planned.game.key);
	};
	let next = 0;
	const lane = async () => {
		while (next < units.length) {
			const unit = units[next++];
			const planned = byKey.get(unit.key);
			let snapshot;
			try {
				snapshot = await snapshotOf(planned);
			} catch (e) {
				writeFailedUnit(unit, `snapshot fetch failed: ${e.message}`);
				continue;
			}
			const r = await renderUnit({
				unit,
				planned,
				runtimeDir: runtimes[unit.side],
				snapshotDir: snapshot.dir,
				chrome,
				seed: thePlan.seed,
				cache,
				out,
				trace: opt.trace ? log : undefined,
			});
			log(
				`${unit.id}: ${Object.keys(r.screens).length} screen(s), ${r.seconds.toFixed(0)} s` +
					(r.error ? ` — ${r.error.split('\n')[0]}` : ''),
			);
		}
	};
	const jobs = Math.max(1, Number(opt.jobs) || 1);
	await Promise.all(Array.from({ length: Math.min(jobs, units.length) }, lane));
}

function compare(thePlan, unitDirs) {
	if (opt['gates-file']) loadGateResults(opt['gates-file']);
	const report = assembleReport({
		plan: thePlan,
		unitDirs,
		out,
		tolerance: loadTolerance(opt.tolerance),
		gates: !opt['no-gates'],
		keepScreens: opt['keep-screens'],
		extra: { seconds: Math.round((Date.now() - started) / 1000) },
	});
	writeSummaryFiles(out, report);
	log(`${report.summary.verdict} — ${report.summary.line}`);
	log(`report: ${join(out, 'index.html')}`);
	process.exit(report.summary.verdict === 'pass' ? 0 : 1);
}

const readPlan = () => {
	if (!opt.plan) abort('--plan <plan.json> is required for this phase');
	return JSON.parse(readFileSync(resolve(opt.plan), 'utf8'));
};

if (opt.phase === 'plan') {
	const thePlan = await plan();
	writeFileSync(join(out, 'plan.json'), JSON.stringify(thePlan, null, '\t'));
	log(`${thePlan.games.length} game(s), ${thePlan.units.length} render unit(s)`);
} else if (opt.phase === 'render') {
	const thePlan = readPlan();
	const [index, count] = opt.shard.split('/').map(Number);
	const units = unitsForShard(thePlan.units, index, count);
	log(`${units.length} unit(s) in shard ${opt.shard}`);
	await render(thePlan, units, {
		base: resolve(opt['base-build']),
		head: resolve(opt['head-build']),
	});
} else if (opt.phase === 'compare') {
	const thePlan = readPlan();
	compare(
		thePlan,
		(opt.units ?? '')
			.split(',')
			.filter(Boolean)
			.map((d) => resolve(d)),
	);
} else {
	const thePlan = await plan();
	let base;
	try {
		base = opt['base-build']
			? { sha: 'local', dir: resolve(opt['base-build']) }
			: runtimeForRef(ROOT, cache, opt['base-ref']);
		log(`base runtime ${base.sha}: ${base.dir}`);
	} catch (e) {
		abort(`base runtime build failed: ${e.message}`);
	}
	thePlan.base = { sha: base.sha, ref: opt['base-build'] ? null : opt['base-ref'] };
	let headDir;
	try {
		headDir = opt['head-build'] ? resolve(opt['head-build']) : buildWorkingTree(ROOT, cache);
		log(`head runtime ${headSha}: ${headDir}`);
	} catch (e) {
		thePlan.buildStatus = { status: 'fail', detail: e.message };
	}
	if (headDir) await render(thePlan, thePlan.units, { base: base.dir, head: headDir });
	compare(thePlan, [out]);
}
