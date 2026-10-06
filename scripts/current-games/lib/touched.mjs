// Can this change reach a game? The harness renders the shared `lines` runtime, so a change that
// touches none of the runtime's inputs, none of the gates' and none of the harness's own cannot make
// a game build, test or look differently — and `current-games.yml` posts success without building
// or rendering anything, the short-circuit a docs-only change already had. A launcher, atlas-tool
// or director-worker PR therefore no longer spends seven runners and fifteen minutes proving what
// its diff already shows.
//
// The inputs are COMPUTED, not listed, so a new workspace package the runtime pulls in counts from
// the day `apps/lines` depends on it: `apps/lines` plus every workspace package reachable from it
// (the set `pnpm --filter 'lines...'` selects, which `touched.fixture.mjs` checks against pnpm's
// own graph), the root build config, the gates and what they read (`scripts/`, the test server the
// mock plays through, the launcher's game-config defaults) and this harness. Anything the diff
// cannot decide — git cannot diff it, or this script cannot read the workspace — is touched: the
// rule only ever skips, never widens.
//
// A second verdict, `republish`, says whether the change can have altered what a PUBLISH bakes from
// the repo: the built-in component defs (`builtinComponents.ts`) and every module they take a value
// from, followed import by import. A published snapshot carries its own copies of those defs, so a
// change to them reaches a game only at its next publish; when this verdict is true the harness also
// renders each affected game as republished (`builtins.mjs`), and when it is false it never spends
// the read that would decide that. The bake's repo inputs lie inside the runtime's closure, so
// `republish` implies `render`.
//
//   node scripts/current-games/lib/touched.mjs --base <sha> [--head <ref>]   classify git's diff
//   … --files -                                                               classify stdin's list
//
// With $GITHUB_OUTPUT set it writes `render`, `republish` and `description` (the status text).

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BUILTIN_DEFS_SOURCE } from './builtins.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');

/** The runtime the harness renders (`runtimes.mjs` builds `lines` and its workspace closure). */
export const RUNTIME_APP = 'apps/lines';

/** Files at the root that change how every workspace package builds. */
const ROOT_BUILD_FILES = [
	'package.json',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
	'turbo.json',
	'.npmrc',
	'tsconfig.base.json',
];

/**
 * What the gates (`gates.mjs`) and the renders read besides the runtime: every `check:*` gate is a
 * script under `scripts/` (and what one imports lives there or in a runtime package), the mock RGS
 * is served through the test server, and `check:stake` plus the game-config fixtures read the
 * launcher's per-template defaults. The harness itself is in `scripts/` too. Accepted exception:
 * `check:undefined-names` scans every app, package and service, so a launcher or service change
 * can fail it; Lint runs that gate on every PR, where such a change is caught.
 */
const GATE_DIRS = ['scripts', 'services/test-server', 'apps/launcher-api/src/lib/data/gameConfig'];
const HARNESS_FILES = ['.github/workflows/current-games.yml'];

/** What `.github/actions/code-changed` calls docs: never an input of anything that ships. */
export const isDoc = (file) =>
	/^docs\//.test(file) || /^\.claude\//.test(file) || /\.md$/.test(file);

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * The workspace's package directories (repo-relative), from the `packages:` list of
 * `pnpm-workspace.yaml`. A negated glob is ignored: that can only widen the closure.
 */
function workspaceDirs(repo) {
	const yaml = readFileSync(join(repo, 'pnpm-workspace.yaml'), 'utf8');
	const dirs = [];
	let inPackages = false;
	for (const line of yaml.split('\n')) {
		if (/^\S/.test(line)) inPackages = /^packages:/.test(line);
		const m = inPackages && /^\s*-\s*["']?([^"'\s#]+)["']?\s*$/.exec(line);
		if (!m) continue;
		const glob = m[1].replace(/\/$/, '');
		if (glob.startsWith('!')) continue;
		if (glob.endsWith('/*')) {
			const parent = glob.slice(0, -2);
			if (!existsSync(join(repo, parent))) continue;
			for (const entry of readdirSync(join(repo, parent), { withFileTypes: true }))
				if (entry.isDirectory()) dirs.push(`${parent}/${entry.name}`);
		} else if (!glob.includes('*')) dirs.push(glob);
		else throw new Error(`pnpm-workspace.yaml: unsupported glob ${glob}`);
	}
	return dirs.filter((dir) => existsSync(join(repo, dir, 'package.json')));
}

/**
 * `app` and every workspace package it depends on, directly or through another, as repo-relative
 * directories. A dependency counts when it names a workspace package, whatever its range: pnpm
 * links one by name too, so this errs towards "touched".
 */
export function runtimeClosure(repo = ROOT, app = RUNTIME_APP) {
	const byName = new Map();
	for (const dir of workspaceDirs(repo)) {
		const pkg = readJson(join(repo, dir, 'package.json'));
		if (pkg.name) byName.set(pkg.name, dir);
	}
	const seen = new Set();
	const visit = (dir) => {
		if (seen.has(dir)) return;
		seen.add(dir);
		const pkg = readJson(join(repo, dir, 'package.json'));
		const deps = {
			...pkg.dependencies,
			...pkg.devDependencies,
			...pkg.peerDependencies,
			...pkg.optionalDependencies,
		};
		for (const name of Object.keys(deps)) if (byName.has(name)) visit(byName.get(name));
	};
	visit(app);
	return [...seen].sort();
}

/** The workspace's packages by name → repo-relative directory. */
function workspaceByName(repo) {
	const byName = new Map();
	for (const dir of workspaceDirs(repo)) {
		const pkg = readJson(join(repo, dir, 'package.json'));
		if (pkg.name) byName.set(pkg.name, dir);
	}
	return byName;
}

/**
 * The specifiers a module takes a VALUE from: `import`/`export … from` statements at the start of a
 * line, less `import type` ones (a type changes no def). `import { type A, B }` counts; so does a
 * side-effect `import './x'`.
 */
const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\s)(?:[^;'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
export const valueImports = (source) => [...source.matchAll(IMPORT_RE)].map((m) => m[1]);

/** A relative specifier as a repo-relative file: `.ts` as written, `<spec>.ts` or `<spec>/index.ts`. */
function resolveRelative(repo, fromDir, spec) {
	const base = posix.join(fromDir, spec);
	for (const candidate of [
		base,
		`${base}.ts`,
		posix.join(base, 'index.ts'),
		base.replace(/\.js$/, '.ts'),
	])
		if (existsSync(join(repo, candidate)) && candidate.endsWith('.ts')) return candidate;
	return undefined;
}

/**
 * What a publish bakes from the repo: `builtinComponents.ts` and, followed import by import, every
 * module it takes a value from — as files inside its package, and as whole directories for a
 * workspace package it imports by name. Computed, not listed, so a new module a def reads counts
 * from the day it is imported.
 */
export function bakeInputs(repo = ROOT) {
	const byName = workspaceByName(repo);
	const files = new Set();
	const dirs = new Set();
	const visit = (rel) => {
		if (files.has(rel)) return;
		files.add(rel);
		for (const spec of valueImports(readFileSync(join(repo, rel), 'utf8'))) {
			if (spec.startsWith('.')) {
				const target = resolveRelative(repo, dirname(rel), spec);
				if (target) visit(target);
			} else {
				const name = spec.startsWith('@')
					? spec.split('/').slice(0, 2).join('/')
					: spec.split('/')[0];
				if (byName.has(name)) dirs.add(byName.get(name));
			}
		}
	};
	visit(BUILTIN_DEFS_SOURCE);
	return { files: [...files].sort(), dirs: [...dirs].sort() };
}

/**
 * Every path a change must stay out of to leave the runtime, its gates and the harness alone, and
 * (`bake`) the subset whose change can alter what a publish bakes.
 */
export function runtimeInputs(repo = ROOT) {
	return {
		dirs: [...new Set([...runtimeClosure(repo), ...GATE_DIRS])].sort(),
		files: [...ROOT_BUILD_FILES, ...HARNESS_FILES].sort(),
		bake: bakeInputs(repo),
	};
}

/** Is `file` the directory `dir` or inside it? A path segment, not a string prefix. */
export const inDir = (file, dir) => file === dir || file.startsWith(`${dir}/`);

/**
 * `{ kind, touching, bake }`: `docs` when every changed file is docs (or nothing changed),
 * `untouched` when none of the rest is an input, `touched` otherwise with the files that are;
 * `bake` is the changed files among the bake's inputs (`inputs.bake`, when given).
 */
export function classifyChange(files, inputs) {
	const code = files.filter((f) => f && !isDoc(f));
	const touching = code.filter(
		(f) => inputs.files.includes(f) || inputs.dirs.some((dir) => inDir(f, dir)),
	);
	const bake = code.filter(
		(f) => inputs.bake?.files.includes(f) || inputs.bake?.dirs.some((dir) => inDir(f, dir)),
	);
	if (touching.length) return { kind: 'touched', touching, bake };
	return { kind: code.length ? 'untouched' : 'docs', touching: [], bake: [] };
}

/** The commit-status description (≤ 140 characters) for a change that is not rendered. */
export function describe(result, changed) {
	if (result.kind === 'docs') return 'Docs-only change: no game can differ';
	const reach = 'reach neither the lines runtime, its gates nor the harness';
	return `Runtime untouched: no game can differ (${changed} changed files ${reach})`;
}

/**
 * The files `git diff base head` names, or null when git cannot. Rename detection is OFF: with it
 * a file moved out of the inputs is listed under its new path only, and the move would read as
 * untouched.
 */
export function changedFiles(base, head, repo = ROOT) {
	const r = spawnSync('git', ['diff', '--name-only', '--no-renames', base, head], {
		cwd: repo,
		encoding: 'utf8',
	});
	if (r.status !== 0) return null;
	return r.stdout.split('\n').filter(Boolean);
}

/** `classifyChange` over the real inputs, or `unknown` when the workspace cannot be read. */
function classify(files) {
	if (!files) return { kind: 'unknown', touching: [] };
	try {
		return classifyChange(files, runtimeInputs());
	} catch (error) {
		console.error(error);
		return { kind: 'unknown', touching: [] };
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const argv = process.argv.slice(2);
	const opt = (name) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	let files;
	if (opt('--files') === '-') files = readFileSync(0, 'utf8').split('\n').filter(Boolean);
	else if (opt('--base')) files = changedFiles(opt('--base'), opt('--head') ?? 'HEAD');
	else {
		console.error('usage: touched.mjs --base <sha> [--head <ref>] | --files -');
		process.exit(2);
	}
	const result = classify(files);
	const render = result.kind === 'touched' || result.kind === 'unknown';
	// Undecidable ⇒ both verdicts err towards rendering.
	const republish = result.kind === 'unknown' || result.bake.length > 0;
	const description = render ? '' : describe(result, files.filter((f) => !isDoc(f)).length);
	if (result.kind === 'unknown') console.log('::notice::change set unknown — rendering every game');
	else if (render) {
		console.log(`runtime inputs changed:\n${result.touching.slice(0, 20).join('\n')}`);
		if (republish)
			console.log(
				`the bake's inputs changed (affected games also render as republished):\n${result.bake.slice(0, 20).join('\n')}`,
			);
	} else console.log(`::notice::${description}`);
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(
			process.env.GITHUB_OUTPUT,
			`render=${render}\nrepublish=${render && republish}\ndescription=${description}\n`,
		);
}
