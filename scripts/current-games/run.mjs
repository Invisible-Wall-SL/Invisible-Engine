// Current-games regression harness (docs/director/DECISIONS/0004, PLAN 1.3–1.6).
// How to run it and read the report: docs/playtest/current-games.md.
//
//   node scripts/current-games/run.mjs
//     [--base-ref origin/main | --base-build <dir>] [--head-build <dir>]
//     [--games-file <json>] [--manifest-file <json>] [--only k1,k2] [--scenario id,id]
//     [--seed current-games] [--out <dir>] [--cache <dir>] [--jobs 1]
//     [--no-gates | --gates-file <json>] [--keep-screens] [--trace] [--chrome <exe>]
//     [--phase all | plan | render | compare] [--plan <json>] [--shard 1/4] [--units <dir>,…]
//
// For every live game: render its PUBLISHED snapshot (read-only from R2) with main's runtime (BASE)
// and the branch's runtime (HEAD), play its game type's screen script (`screens/<gameType>.json`)
// on each with the same seed and forced books, and compare each screen under `tolerance.json`.
// Rows: build / tests / looks the same. Writes `report.json` + `index.html` (+ `summary.txt`,
// `digest.txt`) to --out.
//
// A game whose snapshot ships a copy of a built-in component def the two sides disagree on is
// rendered a second time AS REPUBLISHED — the snapshot with those copies replaced by each side's
// built-ins (`lib/builtins.mjs`) — as a row of its own, because a built-in change reaches a
// published game only at its next publish and the as-published render cannot see it. Planned only
// when the bake's inputs changed (`CURRENT_GAMES_REPUBLISH`, from `lib/touched.mjs`; unset = decide
// from the built-ins alone) and the two builds' `builtins.json` differ.
//
// Phases. `all` (the default, a local run) does everything in one process. CI splits it:
//   plan     list the games, pin each one's snapshot, list the render units → `<out>/plan.json`
//            (`--base-build`/`--head-build` name the builds whose built-ins decide the republished
//            units; without them none are planned)
//   render   render this shard's units (`--plan`, `--shard i/n`) → `<out>/units/<id>/`
//   compare  pair the units of every shard (`--units`), compare, write the report
// A unit is one side of one variant of one scenario of one game; the two sides of a comparison are
// independent renders (fresh test server, fresh browser), so they need not share a runner.
// Exit 1 when a rendered game fails, 2 when the run itself cannot start.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { headlessShell } from '../playtest/headless-shell.mjs';
import { assembleReport } from './lib/assemble.mjs';
import { openPage } from './lib/browser.mjs';
import {
	BUILTINS_FILE,
	canonical,
	publishedBuiltinsFor,
	readBuiltins,
	republishVariants,
} from './lib/builtins.mjs';
import { loadTolerance } from './lib/compare.mjs';
import { loadGateResults } from './lib/gates.mjs';
import { fetchManifest, fetchRuntimeJson, fetchSnapshot, listGames } from './lib/games.mjs';
import {
	contractFor,
	contractHash,
	makePlan,
	planRepublished,
	safe,
	unitsForShard,
} from './lib/plan.mjs';
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
		jobs: { type: 'string', default: '1' },
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

/**
 * The test server's manifest: every game's mock contract (from R2 when a published game needs it,
 * plus `--manifest-file`). Decided from the games alone, so a render phase of stand-in games runs
 * without R2.
 */
async function manifestFor(games) {
	const needsR2 = games.some((g) => g.publishedPointerKey && !g.local?.manifestEntry);
	let manifest = needsR2 ? await fetchManifest({}) : {};
	if (opt['manifest-file'])
		manifest = { ...manifest, ...(await fetchManifest({ manifestFile: opt['manifest-file'] })) };
	return manifest;
}

/** List the games, pin each one's snapshot, list the units. */
async function plan() {
	try {
		const only = opt.only ? new Set(opt.only.split(',')) : null;
		const games = await listGames({ gamesFile: opt['games-file'] });
		// The games the render phase will read the manifest for, so both phases decide alike.
		const manifest = await manifestFor(games.filter((g) => !only || only.has(g.key)));
		const made = await makePlan({
			games,
			manifest,
			only,
			scenarioIds: opt.scenario?.split(','),
		});
		const baseSha = process.env.CURRENT_GAMES_BASE_SHA;
		return {
			version: 3,
			seed: opt.seed,
			head: { sha: headSha },
			base: baseSha ? { sha: baseSha } : undefined,
			...made,
		};
	} catch (e) {
		abort(e.message);
	}
}

/** Where a game's republished variants are made (`base/`, `head/`, `republish.json`). */
const variantsDir = (planned) =>
	join(cache, 'republished', safe(planned.game.key), safe(planned.snapshot.id));

/**
 * Both sides' republished variants of `planned`'s snapshot, from the two builds' built-ins, the
 * baked defs classified against `publishedBuiltinsFile` (the engine the game was published with)
 * when given.
 */
const makeVariants = (planned, bundleFile, runtimes, publishedBuiltinsFile) =>
	republishVariants({
		bundleFile,
		baseBuiltinsFile: join(runtimes.base, BUILTINS_FILE),
		headBuiltinsFile: join(runtimes.head, BUILTINS_FILE),
		publishedBuiltinsFile,
		outDir: variantsDir(planned),
	});

/**
 * The built-ins to tell `planned`'s baked copies by (`publishedBuiltinsFor` in `builtins.mjs`), an
 * engine's extracted into `<out>/builtins/<sha>.json` and named relative to the plan's folder, which
 * travels to the shards as the plan artifact; a fixture's own stays the absolute path it is.
 */
function publishedBuiltinsSource(planned) {
	const found = publishedBuiltinsFor(planned, { builtinsDir: join(out, 'builtins'), cache });
	if (found.file && !planned.game.local) found.file = relative(out, found.file);
	if (found.note) found.note = redactText(found.note);
	return found;
}

/** A plan entry's `publishedBuiltins` as a path: a fixture's absolute one, else beside the plan. */
const publishedBuiltinsFile = (planned, planDir) => {
	const file = planned.republished?.publishedBuiltins;
	if (!file) return undefined;
	return isAbsolute(file) ? file : join(planDir, file);
};

/**
 * Add the republished units to `thePlan`, when the change can have altered what a publish bakes.
 * `CURRENT_GAMES_REPUBLISH` is `touched.mjs`'s verdict on the bake's inputs (`0`: untouched, so
 * nothing is read; `1` or unset: decide from the two builds' built-ins). With the inputs touched,
 * a build that carries no `builtins.json` is a harness fault and fails the run; without that
 * verdict (a local run against an older build) it is a note.
 */
async function planRepublish(thePlan, runtimes) {
	const verdict = process.env.CURRENT_GAMES_REPUBLISH;
	if (verdict === '0') {
		thePlan.republish = { reason: "the bake's inputs are untouched: no republished render" };
		log(thePlan.republish.reason);
		return;
	}
	for (const side of ['base', 'head']) {
		if (runtimes[side] && readBuiltins(runtimes[side])) continue;
		const reason = runtimes[side]
			? `the ${side} build carries no ${BUILTINS_FILE}: republished renders cannot be planned`
			: `no --${side}-build: republished renders cannot be planned`;
		if (verdict === '1') abort(reason);
		thePlan.republish = { reason };
		log(reason);
		return;
	}
	if (canonical(readBuiltins(runtimes.base).defs) === canonical(readBuiltins(runtimes.head).defs)) {
		thePlan.republish = {
			reason: 'the built-in component defs are the same on both sides: no republished render',
		};
		log(thePlan.republish.reason);
		return;
	}
	thePlan.republish = { reason: 'the built-in component defs differ between the sides' };
	await planRepublished(thePlan, {
		bundleFor: (planned) => fetchRuntimeJson(planned.game, cache, planned.snapshot),
		publishedBuiltinsFor: publishedBuiltinsSource,
		variantsFor: (planned, bundleFile, published) =>
			makeVariants(planned, bundleFile, runtimes, published),
	});
	const affected = thePlan.games.filter((p) => p.republished?.affected);
	log(
		`${thePlan.republish.reason}: ${affected.length} game(s) also render as republished` +
			(affected.length ? ` (${affected.map((p) => p.game.key).join(', ')})` : ''),
	);
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

const GPU_KEYS = ['webgl', '2d_canvas', 'gpu_compositing', 'rasterization'];

/** The paths this machine's browser renders with (`chrome://gpu`), for the report. */
async function browserPaths(chrome) {
	const profile = mkdtempSync(join(tmpdir(), 'cg-gpu-'));
	let paths;
	try {
		const page = await openPage(chrome, profile);
		const status = await page.gpuStatus();
		await page.close();
		paths = GPU_KEYS.map((k) => `${k} ${status[k] ?? '?'}`).join(', ');
	} catch (e) {
		paths = `unknown (${e.message})`;
	} finally {
		rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
	}
	writeFileSync(join(out, 'browser.json'), JSON.stringify({ harness: paths }, null, '\t'));
	log(`browser: ${paths}`);
}

/** Render `units` of `thePlan`, `--jobs` at a time. */
async function render(thePlan, units, runtimes) {
	const chrome = headlessShell(opt.chrome);
	await browserPaths(chrome);
	const byKey = new Map(thePlan.games.map((p) => [p.game.key, p]));
	// Read here, not carried in the (public) plan; the plan's hash pins it to what was planned.
	let manifest;
	try {
		manifest = await manifestFor(thePlan.games.map((p) => p.game));
	} catch (e) {
		for (const unit of units) writeFailedUnit(unit, `mock contracts unreadable: ${e.message}`);
		return;
	}
	// One download per snapshot, however many of the game's units run at once.
	const snapshots = new Map();
	const snapshotOf = (planned) => {
		if (!snapshots.has(planned.game.key))
			snapshots.set(planned.game.key, fetchSnapshot(planned.game, cache, planned.snapshot));
		return snapshots.get(planned.game.key);
	};
	// A game's republished variants, once per shard, from the same inputs the plan used (its
	// published built-ins travel beside the plan).
	const planDir = opt.plan ? dirname(resolve(opt.plan)) : out;
	const variants = new Map();
	const variantOf = (planned, snapshot) => {
		if (!variants.has(planned.game.key)) {
			makeVariants(
				planned,
				join(snapshot.dir, 'runtime.json'),
				runtimes,
				publishedBuiltinsFile(planned, planDir),
			);
			variants.set(planned.game.key, variantsDir(planned));
		}
		return variants.get(planned.game.key);
	};
	let next = 0;
	const lane = async () => {
		while (next < units.length) {
			const unit = units[next++];
			const planned = byKey.get(unit.key);
			const contract = contractFor(planned.game, manifest);
			if (contractHash(contract) !== planned.contractHash) {
				writeFailedUnit(
					unit,
					"the game's mock contract changed during the run (test_server/games.json was rewritten)",
				);
				continue;
			}
			let snapshot;
			try {
				snapshot = await snapshotOf(planned);
			} catch (e) {
				writeFailedUnit(unit, `snapshot fetch failed: ${e.message}`);
				continue;
			}
			let bundleFile;
			if (unit.variant === 'republished') {
				try {
					bundleFile = join(variantOf(planned, snapshot), unit.side, 'runtime.json');
				} catch (e) {
					writeFailedUnit(unit, `the republished variant could not be made: ${e.message}`);
					continue;
				}
			}
			const r = await renderUnit({
				unit,
				planned,
				contract,
				runtimeDir: runtimes[unit.side],
				snapshotDir: snapshot.dir,
				bundleFile,
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
	if (opt['gates-file'] && !thePlan.aborted) {
		if (!existsSync(opt['gates-file'])) abort('no gate results (the gates job did not finish)');
		loadGateResults(opt['gates-file']);
	}
	const browserFile = unitDirs.map((d) => join(d, 'browser.json')).find((f) => existsSync(f));
	const report = assembleReport({
		plan: thePlan,
		unitDirs,
		out,
		tolerance: loadTolerance(opt.tolerance),
		gates: !opt['no-gates'],
		keepScreens: opt['keep-screens'],
		extra: {
			shards: unitDirs.length,
			browser: browserFile ? JSON.parse(readFileSync(browserFile, 'utf8')) : undefined,
		},
	});
	writeSummaryFiles(out, report);
	log(`${report.summary.verdict} — ${report.summary.line}`);
	log(`report: ${join(out, 'index.html')}`);
	process.exit(report.summary.verdict === 'pass' ? 0 : 1);
}

// A missing input still ends in a report that names it: the status step posts that reason.
const readPlan = () => {
	if (!opt.plan) abort('--plan <plan.json> is required for this phase');
	if (!existsSync(resolve(opt.plan))) abort('no plan was made (the build job did not finish)');
	return JSON.parse(readFileSync(resolve(opt.plan), 'utf8'));
};

if (opt.phase === 'plan') {
	const thePlan = await plan();
	await planRepublish(thePlan, {
		base: opt['base-build'] && resolve(opt['base-build']),
		head: opt['head-build'] && resolve(opt['head-build']),
	});
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
	if (headDir) {
		const runtimes = { base: base.dir, head: headDir };
		await planRepublish(thePlan, runtimes);
		await render(thePlan, thePlan.units, runtimes);
	}
	compare(thePlan, [out]);
}
