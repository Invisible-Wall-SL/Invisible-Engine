// Build the runtimes the way `.github/workflows/runtime-release.yml` does — workspace packages
// first (a stale `dist` silently ships old engine code), then `apps/lines` once per runtime id with
// the release's public env and that id's `PUBLIC_IE_FAMILIES` — and keep each checkout's builds
// under `<cache>/runtimes/<sha>/<id>/`. A SHA's runtimes never change, so main's are built once per
// main commit and reused (CI restores the folder with actions/cache). Each checkout builds by ITS
// OWN runtime list (`packages/constants-shared/runtimes.ts`), never the harness's, so a SHA's
// builds are the same whichever branch runs the compare. A ref with no list (before P11.1b) has one
// runtime that plays every family: `lines` is built once, unset, and stands in for every id. `runtimes.json` beside the builds maps each id to its
// folder; a game renders on the id its publish would pick (`runtimeIdFor`).
// The Sentry and build-SHA env are left out: without a DSN the bundle carries no SDK, and a SHA
// stamped into one side only would be a difference the harness put there.
//
// Beside each build sits `builtins.json`, the checkout's built-in component defs as data
// (`builtins.mjs`): what a publish on that commit would bake into a game, which the "as republished"
// render needs from both sides.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { familyOfKind } from '../../../packages/constants-shared/gameKinds.ts';
import {
	FALLBACK_RUNTIME_ID,
	RUNTIME_IDS,
	runtimeIdOfFamily,
} from '../../../packages/constants-shared/runtimes.ts';
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
const RUNTIMES_FILE = 'runtimes.json';

/** The runtime id a game of kind `gameType` is published to (`runtimeFor` in the launcher). */
export const runtimeIdFor = (gameType) => runtimeIdOfFamily(familyOfKind(gameType));

/**
 * Which folder of `checkout`'s build serves each of `ids`: its own, or, on a checkout from before
 * the family seams, `lines` for every id (all of them, so a later run asking for more ids reuses it).
 */
export const runtimeFolders = (checkout, ids) => {
	if (existsSync(runtimeList(checkout))) return Object.fromEntries(ids.map((id) => [id, id]));
	return Object.fromEntries(RUNTIME_IDS.map((id) => [id, FALLBACK_RUNTIME_ID]));
};

const runtimeList = (checkout) => join(checkout, 'packages/constants-shared/runtimes.ts');

/** The `PUBLIC_IE_FAMILIES` `checkout`'s own release builds runtime `id` with. */
export const familiesIn = (checkout, id) =>
	execFileSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			'const [file, id] = process.argv.slice(1); ' +
				'const m = await import(file); process.stdout.write(m.releaseFamiliesOf(id));',
			pathToFileURL(runtimeList(checkout)).href,
			id,
		],
		{ encoding: 'utf8' },
	);

/**
 * The build of runtime `id` in a side's folder. A folder with no `runtimes.json` is one plain build
 * (`--head-build apps/lines/build`), which serves every id.
 */
export function runtimeDirFor(dir, id) {
	const file = join(dir, RUNTIMES_FILE);
	if (!existsSync(file)) return dir;
	const folder = JSON.parse(readFileSync(file, 'utf8'))[id];
	if (!folder) throw new Error(`${dir} has no ${id} runtime (it has ${RUNTIMES_FILE} without it)`);
	return join(dir, folder);
}

/** A complete build: every id in `ids` and the built-ins (a build missing either is rebuilt). */
const complete = (out, ids) => {
	if (!existsSync(join(out, DONE)) || !existsSync(join(out, BUILTINS_FILE))) return false;
	if (!existsSync(join(out, RUNTIMES_FILE))) return false;
	const folders = JSON.parse(readFileSync(join(out, RUNTIMES_FILE), 'utf8'));
	return ids.every((id) => folders[id]);
};

/** Build `checkout`'s runtimes for `ids` into `out` (replacing it). */
function buildInto(checkout, out, ids) {
	const folders = runtimeFolders(checkout, ids);
	const listed = existsSync(runtimeList(checkout));
	run('pnpm', ['--filter', 'lines^...', 'build'], checkout);
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	for (const folder of new Set(Object.values(folders))) {
		// Each id's build starts empty, as on its own release runner: no file of the last one leaks in.
		rmSync(join(checkout, 'apps/lines/build'), { recursive: true, force: true });
		run('pnpm', ['--filter', 'lines', 'build'], checkout, {
			...RELEASE_ENV,
			...(listed ? { PUBLIC_IE_FAMILIES: familiesIn(checkout, folder) } : {}),
		});
		cpSync(join(checkout, 'apps/lines/build'), join(out, folder), { recursive: true });
	}
	writeFileSync(join(out, RUNTIMES_FILE), JSON.stringify(folders, null, '\t'));
	extractBuiltins(checkout, join(out, BUILTINS_FILE));
	writeFileSync(join(out, DONE), new Date().toISOString());
}

/**
 * The working tree's runtimes for `ids` (the branch side). Always rebuilt: the tree may be dirty.
 */
export function buildWorkingTree(repo, cache, ids = RUNTIME_IDS) {
	const out = join(cache, 'runtimes', 'working-tree');
	buildInto(repo, out, ids);
	return out;
}

/**
 * `ref`'s runtimes for `ids`, from the cache or built in a throwaway worktree. Returns
 * `{ sha, dir, cached }`.
 */
export function runtimeForRef(repo, cache, ref, ids = RUNTIME_IDS) {
	const sha = gitSha(repo, ref);
	const out = join(cache, 'runtimes', sha);
	if (complete(out, ids)) return { sha, dir: out, cached: true };
	const worktree = join(cache, 'worktrees', sha);
	rmSync(worktree, { recursive: true, force: true });
	run('git', ['worktree', 'add', '--detach', '--force', worktree, sha], repo);
	try {
		run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], worktree);
		buildInto(worktree, out, ids);
	} finally {
		spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repo });
	}
	return { sha, dir: out, cached: false };
}
