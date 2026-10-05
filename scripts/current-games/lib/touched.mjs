// Can this change reach a game? The harness renders the shared `lines` runtime, so a change that
// touches none of the runtime's inputs, none of the gates' and none of the harness's own cannot make
// a game build, test or look differently — and `current-games.yml` posts success without building
// or rendering anything, the short-circuit a docs-only change already had. A launcher, atlas-tool
// or director-worker PR therefore no longer spends seven runners and fifteen minutes proving what
// its diff already shows.
//
// The inputs are COMPUTED, not listed, so a new workspace package the runtime pulls in counts from
// the day `apps/lines` depends on it: `apps/lines` plus every workspace package reachable from it
// (the set `pnpm --filter 'lines^...' build` builds, which `touched.fixture.mjs` checks against
// pnpm's own graph), the root build config, the gates and everything they can read (`scripts/`,
// the test server the mock plays through, the launcher's game-config defaults) and this harness.
// Anything the diff cannot decide is touched: the rule only ever skips, never widens.
//
//   node scripts/current-games/lib/touched.mjs --base <sha> [--head <ref>]   classify git's diff
//   … --files -                                                               classify stdin's list
//
// With $GITHUB_OUTPUT set it writes `render`, `reason` and `description` (the status text).

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
 * launcher's per-template defaults. The harness itself is in `scripts/` too.
 */
const GATE_DIRS = ['scripts', 'services/test-server', 'apps/launcher-api/src/lib/data/gameConfig'];
const HARNESS_FILES = ['.github/workflows/current-games.yml'];

/** What `.github/actions/code-changed` calls docs: never an input of anything that ships. */
export const isDoc = (file) =>
	/^docs\//.test(file) || /^\.claude\//.test(file) || /\.md$/.test(file);

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** The workspace's package directories (repo-relative), from `pnpm-workspace.yaml`'s globs. */
function workspaceDirs(repo) {
	const yaml = readFileSync(join(repo, 'pnpm-workspace.yaml'), 'utf8');
	const dirs = [];
	for (const line of yaml.split('\n')) {
		const m = /^\s*-\s*["']?([^"'\s#]+)["']?\s*$/.exec(line);
		if (!m) continue;
		const glob = m[1].replace(/\/$/, '');
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

/** Every path a change must stay out of to leave the runtime, its gates and the harness alone. */
export function runtimeInputs(repo = ROOT) {
	return {
		dirs: [...new Set([...runtimeClosure(repo), ...GATE_DIRS])].sort(),
		files: [...ROOT_BUILD_FILES, ...HARNESS_FILES].sort(),
	};
}

const inDir = (file, dir) => file === dir || file.startsWith(`${dir}/`);

/**
 * `{ kind, touching }`: `docs` when every changed file is docs (or nothing changed), `untouched`
 * when none of the rest is an input, `touched` otherwise with the files that are.
 */
export function classifyChange(files, inputs) {
	const code = files.filter((f) => f && !isDoc(f));
	const touching = code.filter(
		(f) => inputs.files.includes(f) || inputs.dirs.some((dir) => inDir(f, dir)),
	);
	if (touching.length) return { kind: 'touched', touching };
	return { kind: code.length ? 'untouched' : 'docs', touching: [] };
}

/** The commit-status description (≤ 140 characters) for a change that is not rendered. */
export function describe(result, changed) {
	if (result.kind === 'docs') return 'Docs-only change: no game can differ';
	return `Runtime untouched: no game can differ (${changed} changed files reach neither the lines runtime, its gates nor the harness)`;
}

function changedFiles(base, head) {
	const r = spawnSync('git', ['diff', '--name-only', base, head], { cwd: ROOT, encoding: 'utf8' });
	if (r.status !== 0) return null;
	return r.stdout.split('\n').filter(Boolean);
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
	const result = files ? classifyChange(files, runtimeInputs()) : { kind: 'unknown', touching: [] };
	const render = result.kind === 'touched' || result.kind === 'unknown';
	const description = render ? '' : describe(result, files.length);
	if (result.kind === 'unknown') console.log('::notice::change set unknown — rendering every game');
	else if (render)
		console.log(`runtime inputs changed:\n${result.touching.slice(0, 20).join('\n')}`);
	else console.log(`::notice::${description}`);
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(
			process.env.GITHUB_OUTPUT,
			`render=${render}\nreason=${result.kind}\ndescription=${description}\n`,
		);
}
