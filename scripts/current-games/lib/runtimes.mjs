// Build the shared `lines` runtime the way `.github/workflows/runtime-release.yml` does — workspace
// packages first (a stale `dist` silently ships old engine code), then the app with the release's
// public env — and keep each build under `<cache>/runtimes/<sha>/`. A SHA's runtime never changes,
// so main's is built once per main commit and reused (CI restores the folder with actions/cache).
// The Sentry and build-SHA env are left out: without a DSN the bundle carries no SDK, and a SHA
// stamped into one side only would be a difference the harness put there.
//
// Beside each build sits `builtins.json`, the checkout's built-in component defs as data
// (`builtins.mjs`): what a publish on that commit would bake into a game, which the "as republished"
// render needs from both sides.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BUILTINS_FILE, extractBuiltins } from './builtins.mjs';

export const RELEASE_ENV = { PUBLIC_RGS_TRANSPORT: 'play4fun', PUBLIC_DELIVERY_PROFILES: '*' };

const run = (cmd, args, cwd, env = {}) => {
	const r = spawnSync(cmd, args, {
		cwd,
		env: { ...process.env, ...env },
		stdio: ['ignore', 'inherit', 'inherit'],
		shell: process.platform === 'win32',
	});
	if (r.status !== 0)
		throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd} (exit ${r.status})`);
};

export const gitSha = (repo, ref) => {
	const r = spawnSync('git', ['rev-parse', ref], { cwd: repo, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git rev-parse ${ref}: ${r.stderr.trim()}`);
	return r.stdout.trim();
};

const DONE = '.current-games-complete';

/** A complete build: the runtime and its built-ins (a build from before the latter is rebuilt). */
const complete = (out) => existsSync(join(out, DONE)) && existsSync(join(out, BUILTINS_FILE));

/** Build `checkout`'s runtime into `out` (replacing it). */
function buildInto(checkout, out) {
	run('pnpm', ['--filter', 'lines^...', 'build'], checkout);
	run('pnpm', ['--filter', 'lines', 'build'], checkout, RELEASE_ENV);
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	cpSync(join(checkout, 'apps/lines/build'), out, { recursive: true });
	extractBuiltins(checkout, join(out, BUILTINS_FILE));
	writeFileSync(join(out, DONE), new Date().toISOString());
}

/** The working tree's runtime (the branch side). Always rebuilt: the tree may be dirty. */
export function buildWorkingTree(repo, cache) {
	const out = join(cache, 'runtimes', 'working-tree');
	buildInto(repo, out);
	return out;
}

/**
 * `ref`'s runtime, from the cache or built in a throwaway worktree. Returns `{ sha, dir, cached }`.
 */
export function runtimeForRef(repo, cache, ref) {
	const sha = gitSha(repo, ref);
	const out = join(cache, 'runtimes', sha);
	if (complete(out)) return { sha, dir: out, cached: true };
	const worktree = join(cache, 'worktrees', sha);
	rmSync(worktree, { recursive: true, force: true });
	run('git', ['worktree', 'add', '--detach', '--force', worktree, sha], repo);
	try {
		run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], worktree);
		buildInto(worktree, out);
	} finally {
		spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repo });
	}
	return { sha, dir: out, cached: false };
}
