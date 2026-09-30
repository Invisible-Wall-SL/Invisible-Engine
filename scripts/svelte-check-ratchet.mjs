// svelte-check ratchet — fail on a NEW type error in any Svelte package, pass when errors go down.
//
//   pnpm check:svelte                          # every Svelte package against the baseline
//   pnpm check:svelte --only apps/lines        # one package (comma list or repeat the flag)
//   pnpm check:svelte --shard 1/2              # the CI split (by package, balanced on cost)
//   pnpm check:svelte --update                 # rewrite the baseline for the packages that ran
//   pnpm check:svelte --list                   # which packages, in which shard
//
// WHY THIS EXISTS: nothing type-checked the Svelte code. An app's `build` is a bare `vite build`
// (esbuild, per file, no types), and svelte-check was not a dependency anywhere — people ran it ad
// hoc via `pnpm dlx`, and `apps/lines` alone sat at ~190 errors that nobody could tell apart from a
// new one. Lint's `check:undefined-names` covers exactly one error class; this covers the rest.
//
// HOW THE GATE WORKS: `svelte-check-baseline.json` records, per package, every ERROR as a count per
// (file, rule) — the rule is `<source>:<code>`, e.g. `ts:2307`. Line numbers are left out so an
// unrelated edit above an old error does not read as a new one. A run fails when any (file, rule)
// count goes UP, which covers a brand-new file or rule as well as one more of an existing error; it
// passes when counts go down, and says which entries to lower. Warnings are not gated.
//
// THE BASELINE IS A CLEAN CHECKOUT'S: some of today's errors come from files a checkout only has
// after a build or an asset pull (`static/assets/**`, the baked editor bundle, `.env`). CI runs on
// a fresh clone, so the baseline must be taken on one too — a fresh worktree after
// `pnpm install`, nothing else. A working copy with pulled assets reports fewer errors (a notice,
// not a failure); a pull that ADDS errors reads as new ones.
//
// DISCOVERED: every workspace package with a tracked `.svelte` file and a tsconfig is checked; a new
// one is gated the day it lands, and must list `svelte-check` in its devDependencies (the run says
// so if it does not). SvelteKit packages are `svelte-kit sync`ed first, so `$app/*`, `./$types` and
// the launcher's generated tsconfig exist.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_FILE = 'svelte-check-baseline.json';

/**
 * Heap for svelte-check, in MB. `apps/lines` type-checks most of `packages/*` through its imports
 * and dies with "heap out of memory" (exit 134) on Node's default ~4 GB; 8 GB is what it needs
 * with headroom, and a GitHub runner has 16.
 */
const HEAP_MB = 8192;

/** Rough relative cost, used only to balance the CI shards. Unlisted packages cost 1. */
const COST = { 'apps/lines': 10, 'apps/launcher-api': 8 };

const posix = (p) => p.split(sep).join('/');

export function discoverPackages(root = ROOT) {
	const files = spawnSync('git', ['ls-files', '-z', '--', 'apps', 'packages'], {
		cwd: root,
		encoding: 'utf8',
	})
		.stdout.split('\0')
		.filter(Boolean);
	const dirs = new Set();
	for (const rel of files) {
		const m = /^((?:apps|packages)\/[^/]+)\/.*\.svelte$/.exec(rel);
		if (m && existsSync(join(root, m[1], 'tsconfig.json'))) dirs.add(m[1]);
	}
	return [...dirs].sort();
}

/**
 * Deterministic split: packages sorted by cost (heaviest first, then name) and each handed to the
 * lightest shard so far, so the two heavy apps never land together.
 */
export function shardOf(pkgs, index, total) {
	const load = Array.from({ length: total }, () => 0);
	const owner = new Map();
	const byCost = [...pkgs].sort((a, b) => (COST[b] ?? 1) - (COST[a] ?? 1) || a.localeCompare(b));
	for (const pkg of byCost) {
		let lightest = 0;
		for (let i = 1; i < total; i++) if (load[i] < load[lightest]) lightest = i;
		load[lightest] += COST[pkg] ?? 1;
		owner.set(pkg, lightest);
	}
	return pkgs.filter((pkg) => owner.get(pkg) === index - 1);
}

/**
 * Repo-relative POSIX path. A workspace dependency is reached through its `node_modules` symlink
 * (`apps/lines/node_modules/engine-game/…`), so it is resolved to the real file: the same error
 * then has one key however it was reached, on Windows and Linux alike.
 */
function repoPath(abs, root) {
	let real = abs;
	try {
		real = realpathSync(abs);
	} catch {
		// Not on disk (a fixture, or a file deleted since): keep the path as reported.
	}
	return posix(relative(root, real));
}

/**
 * `<source>:<code>`. A diagnostic in a plain `.ts` file carries no `source` — only the compiler's
 * numeric code — so a numeric code without one is `ts`.
 */
function ruleOf(d) {
	const source = d.source ?? (typeof d.code === 'number' ? 'ts' : 'unknown');
	return d.code === undefined ? source : `${source}:${d.code}`;
}

/**
 * Parse `svelte-check --output machine-verbose`. Returns `null` when the run never printed its
 * COMPLETED line — it crashed (an OOM prints nothing a grep would notice), which must never read
 * as "no errors".
 */
export function parseMachineVerbose(stdout, workspace, root = ROOT) {
	const errors = [];
	let completed = null;
	for (const line of stdout.split(/\r?\n/)) {
		const body = line.replace(/^\d+\s+/, '');
		const done = /^COMPLETED\s+(\d+)\s+FILES\s+(\d+)\s+ERRORS/.exec(body);
		if (done) {
			completed = { files: Number(done[1]), errors: Number(done[2]) };
			continue;
		}
		if (!body.startsWith('{')) continue;
		let d;
		try {
			d = JSON.parse(body);
		} catch {
			continue;
		}
		if (d.type !== 'ERROR') continue;
		errors.push({
			file: repoPath(resolve(workspace, d.filename), root),
			rule: ruleOf(d),
			line: (d.start?.line ?? 0) + 1,
			message: String(d.message ?? '').split('\n')[0],
		});
	}
	if (!completed) return null;
	if (completed.errors !== errors.length)
		throw new Error(
			`svelte-check reported ${completed.errors} errors but printed ${errors.length} — output format changed?`,
		);
	return errors;
}

/** `{ errors, byFile: { file: { rule: count } } }`, keys sorted so the JSON diffs cleanly. */
export function summarize(errors) {
	const byFile = {};
	for (const { file, rule } of errors) {
		byFile[file] ??= {};
		byFile[file][rule] = (byFile[file][rule] ?? 0) + 1;
	}
	const sorted = {};
	for (const file of Object.keys(byFile).sort()) {
		sorted[file] = {};
		for (const rule of Object.keys(byFile[file]).sort()) sorted[file][rule] = byFile[file][rule];
	}
	return { errors: errors.length, byFile: sorted };
}

/** Every (file, rule) whose count moved, split into what grew and what shrank. */
export function compare(baseline, current) {
	const base = baseline?.byFile ?? {};
	const cur = current.byFile;
	const increased = [];
	const decreased = [];
	for (const file of new Set([...Object.keys(base), ...Object.keys(cur)])) {
		for (const rule of new Set([
			...Object.keys(base[file] ?? {}),
			...Object.keys(cur[file] ?? {}),
		])) {
			const was = base[file]?.[rule] ?? 0;
			const now = cur[file]?.[rule] ?? 0;
			if (now > was) increased.push({ file, rule, was, now });
			else if (now < was) decreased.push({ file, rule, was, now });
		}
	}
	const order = (a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule);
	return {
		increased: increased.sort(order),
		decreased: decreased.sort(order),
		was: baseline?.errors ?? 0,
		now: current.errors,
	};
}

function readBaseline() {
	const path = join(ROOT, BASELINE_FILE);
	return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

function writeBaseline(baseline) {
	const sorted = {};
	for (const pkg of Object.keys(baseline).sort()) sorted[pkg] = baseline[pkg];
	writeFileSync(join(ROOT, BASELINE_FILE), JSON.stringify(sorted, null, '\t') + '\n');
}

function resolveIn(pkgDir, specifier) {
	try {
		return createRequire(join(ROOT, pkgDir, 'package.json')).resolve(specifier);
	} catch {
		return null;
	}
}

function binOf(pkgJsonPath, name) {
	const { bin } = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
	return join(dirname(pkgJsonPath), typeof bin === 'string' ? bin : bin[name]);
}

function runPackage(pkg) {
	const cwd = join(ROOT, pkg);
	const checkPkg = resolveIn(pkg, 'svelte-check/package.json');
	const declared = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).devDependencies;
	if (!checkPkg || !declared?.['svelte-check'])
		throw new Error(`${pkg}: add "svelte-check" to its devDependencies, then \`pnpm install\``);

	const kitPkg = resolveIn(pkg, '@sveltejs/kit/package.json');
	if (kitPkg && existsSync(join(cwd, 'svelte.config.js'))) {
		const sync = spawnSync(process.execPath, [binOf(kitPkg, 'svelte-kit'), 'sync'], {
			cwd,
			encoding: 'utf8',
		});
		if (sync.status !== 0)
			throw new Error(`${pkg}: svelte-kit sync failed\n${sync.stdout}${sync.stderr}`);
	}

	const started = Date.now();
	const run = spawnSync(
		process.execPath,
		[
			`--max-old-space-size=${HEAP_MB}`,
			binOf(checkPkg, 'svelte-check'),
			'--workspace',
			cwd,
			'--tsconfig',
			join(cwd, 'tsconfig.json'),
			'--output',
			'machine-verbose',
			'--threshold',
			'error',
		],
		{ cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
	);
	const errors = parseMachineVerbose(run.stdout ?? '', cwd);
	if (!errors)
		throw new Error(
			`${pkg}: svelte-check did not complete (exit ${run.status}${run.signal ? `, ${run.signal}` : ''})\n` +
				`${(run.stderr ?? '').slice(-4000)}`,
		);
	return { errors, seconds: Math.round((Date.now() - started) / 1000) };
}

function report(pkg, result, diff, errors, update) {
	const head = `${pkg}: ${diff.now} errors (baseline ${diff.was}) in ${result.seconds}s`;
	if (diff.increased.length === 0 && diff.decreased.length === 0) {
		console.log(`✓ ${head}`);
		return true;
	}
	if (diff.increased.length === 0) {
		console.log(`✓ ${head} — fewer errors than the baseline:`);
		for (const d of diff.decreased) console.log(`    ${d.file}  ${d.rule}  ${d.was} → ${d.now}`);
		if (!update)
			console.log(
				`::notice title=svelte-check baseline can go down::${pkg} is at ${diff.now} errors, ` +
					`the baseline says ${diff.was}. Lower it: pnpm check:svelte --only ${pkg} --update`,
			);
		return true;
	}
	console.log(`✗ ${head} — NEW errors:`);
	for (const d of diff.increased) {
		console.log(`    ${d.file}  ${d.rule}  ${d.was} → ${d.now}`);
		for (const e of errors.filter((x) => x.file === d.file && x.rule === d.rule))
			console.log(`        ${e.file}:${e.line}  ${e.message}`);
		if (!update)
			console.log(
				`::error file=${d.file},title=svelte-check ${d.rule}::${d.now - d.was} new ${d.rule} ` +
					`error(s) in ${d.file} (baseline ${d.was}, now ${d.now})`,
			);
	}
	return false;
}

function main(argv) {
	const opt = (name) => {
		const out = [];
		for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1]) out.push(argv[++i]);
		return out;
	};
	const update = argv.includes('--update');
	const all = discoverPackages();
	const only = opt('--only')
		.flatMap((s) => s.split(','))
		.map((s) => s.replace(/\/$/, ''));
	for (const pkg of only) if (!all.includes(pkg)) throw new Error(`not a Svelte package: ${pkg}`);
	const [shard] = opt('--shard');
	let pkgs = only.length ? only : all;
	if (shard) {
		const [i, n] = shard.split('/').map(Number);
		if (!(i >= 1 && i <= n)) throw new Error(`bad --shard ${shard}`);
		pkgs = shardOf(pkgs, i, n);
	}

	if (argv.includes('--list')) {
		for (const pkg of pkgs) console.log(pkg);
		return;
	}

	const baseline = readBaseline();
	let ok = true;
	for (const pkg of pkgs) {
		const result = runPackage(pkg);
		const current = summarize(result.errors);
		const diff = compare(baseline[pkg], current);
		if (!report(pkg, result, diff, result.errors, update)) ok = false;
		if (update) baseline[pkg] = current;
	}

	if (update) {
		// A package that no longer has Svelte files (or was removed) drops out of the baseline.
		if (!shard && !only.length)
			for (const pkg of Object.keys(baseline)) if (!all.includes(pkg)) delete baseline[pkg];
		writeBaseline(baseline);
		console.log(`\nwrote ${BASELINE_FILE} for ${pkgs.length} package(s)`);
		return;
	}
	if (!ok) {
		console.log(
			'\nFix the new errors. If one is a baseline error that only MOVED (a file renamed, an error ' +
				'relocated), re-record with `pnpm check:svelte --only <pkg> --update` and say so in the PR.',
		);
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		main(process.argv.slice(2));
	} catch (err) {
		console.error(err.message);
		process.exit(2);
	}
}
