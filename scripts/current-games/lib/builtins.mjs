// The built-in component defs of a runtime, as data beside its build (`<runtime>/builtins.json`),
// and the "as republished" variants of a snapshot made from them.
//
// Publishing bakes the component defs a game uses into its snapshot (`runtimeBundle.ts`: each
// referenced id resolves project ◁ shared ◁ built-in), and the runtime registers them over its own
// built-ins (`registerBakedComponents`). So a change to `builtinComponents.ts` reaches a published
// game only at its next publish, and the as-published render shows nothing (measured 2026-10-05,
// docs/playtest/current-games.md). The republished variant is the snapshot with every baked COPY of
// a built-in replaced by the side's built-in and the component closure re-resolved as the bake does,
// so each side renders what a republish of the game on that commit would produce.
//
// The TypeScript half — reading `BUILTIN_COMPONENTS` and the closure walk, which import
// engine-layout's sources — is `republish.mjs`, run under the TS loader as a child process. This
// module is what the plain-node runner, build and plan call.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');
const REPUBLISH = join(import.meta.dirname, 'republish.mjs');

/** The file beside a runtime build that holds its built-in defs (`{ version, defs: { id: def } }`). */
export const BUILTINS_FILE = 'builtins.json';

/** The source every build reads its built-in defs from. */
export const BUILTIN_DEFS_SOURCE = 'packages/engine-layout/src/lib/builtinComponents.ts';

/** JSON with every object's keys sorted, so two defs compare by content, not by key order. */
export function canonical(value) {
	const sort = (v) => {
		if (Array.isArray(v)) return v.map(sort);
		if (v && typeof v === 'object')
			return Object.fromEntries(
				Object.keys(v)
					.sort()
					.map((k) => [k, sort(v[k])]),
			);
		return v;
	};
	// A JSON round trip first: `undefined` fields drop, as they did when the bake wrote the snapshot.
	return JSON.stringify(sort(JSON.parse(JSON.stringify(value ?? null))));
}

/**
 * Run `republish.mjs <command> …` under the TS loader. `cwd` is the checkout whose
 * `scripts/ts-loader.mjs` and `node_modules` resolve the imports: the worktree being built for an
 * extraction, this repo for the variants. Every path in `args` must already be absolute: the child
 * resolves a relative one against ITS cwd, not the caller's (CI hands the build a relative cache
 * path, and the first run resolved the worktree's source against the worktree itself).
 */
function republishCli(cwd, args) {
	const r = spawnSync(
		process.execPath,
		[
			'--experimental-strip-types',
			'--no-warnings',
			'--import',
			'./scripts/ts-loader.mjs',
			REPUBLISH,
			...args,
		],
		{ cwd: resolve(cwd), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
	);
	if (r.status !== 0)
		throw new Error(`${(r.stderr || r.stdout || `exit ${r.status}`).trim().slice(-800)}`);
	return r.stdout;
}

/**
 * Write `checkout`'s built-in defs to `outFile`, read from its own `builtinComponents.ts` with its
 * own loader and dependencies. Part of every runtime build (`runtimes.mjs`), so a cached build
 * carries them too.
 */
export function extractBuiltins(checkout, outFile) {
	try {
		republishCli(checkout, [
			'extract',
			'--source',
			resolve(checkout, BUILTIN_DEFS_SOURCE),
			'--out',
			resolve(outFile),
		]);
	} catch (e) {
		throw new Error(`built-in component defs could not be read from ${checkout}: ${e.message}`);
	}
}

/** A runtime build's built-ins (`{ version, defs }`), or null when the build carries none. */
export function readBuiltins(runtimeDir) {
	const file = join(runtimeDir, BUILTINS_FILE);
	return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/** The full sha `ref` names in `repo`, or null when it names no commit there. */
export function resolveCommit(ref, repo = ROOT) {
	if (!/^[\w.~^/-]+$/.test(String(ref))) return null;
	const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
		cwd: repo,
		encoding: 'utf8',
	});
	return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * The built-in defs as they were at commit `sha` (the engine a game was published with), written to
 * `outFile`: a detached worktree of that commit, read with its own loader, removed again. Needs no
 * install, since the defs import only their own package's sources. Throws when the commit cannot be
 * checked out or read.
 */
export function extractBuiltinsAt(sha, outFile, { repo = ROOT, cache } = {}) {
	const worktree = join(
		cache ?? join(repo, '.cache/current-games'),
		'worktrees',
		`builtins-${sha}`,
	);
	rmSync(worktree, { recursive: true, force: true });
	const add = spawnSync('git', ['worktree', 'add', '--detach', '--force', worktree, sha], {
		cwd: repo,
		encoding: 'utf8',
	});
	if (add.status !== 0) throw new Error(`git worktree add ${sha}: ${add.stderr.trim()}`);
	try {
		mkdirSync(dirname(resolve(outFile)), { recursive: true });
		extractBuiltins(worktree, outFile);
	} finally {
		spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repo });
	}
}

/**
 * The built-ins to tell a planned game's baked copies by, as `{ file, note }`: a fixture's own
 * (`game.local.publishedBuiltins`), else the built-ins of the engine commit its pointer records
 * (`snapshot.engine.shortCommit`, extracted once into `<builtinsDir>/<sha>.json`), else no file —
 * main's stand in — with `note` saying which, for the report. A missing or unreadable engine never
 * fails the run: it narrows what the republished row can see, and the note says so.
 */
export function publishedBuiltinsFor(planned, { builtinsDir, cache, repo = ROOT }) {
	const { game, snapshot } = planned;
	if (game.local?.publishedBuiltins)
		return { file: game.local.publishedBuiltins, note: 'the built-ins the fixture was baked from' };
	const engine = snapshot?.engine;
	if (!engine?.shortCommit)
		return { note: "main's built-ins, since the pointer records no engine for this snapshot" };
	const sha = resolveCommit(engine.shortCommit, repo);
	if (!sha)
		return {
			note: `main's built-ins, since engine ${engine.shortCommit} is not a commit in this checkout`,
		};
	const file = join(builtinsDir, `${sha}.json`);
	if (!existsSync(file)) {
		try {
			extractBuiltinsAt(sha, file, { repo, cache });
		} catch (e) {
			return {
				note:
					`main's built-ins, since the built-ins at engine ${engine.shortCommit} could not be read ` +
					`(${e.message.split('\n')[0].slice(0, 200)})`,
			};
		}
	}
	return {
		file,
		note:
			`the built-ins of engine ${engine.version || engine.shortCommit} (${engine.shortCommit}), ` +
			'the one this game was published with',
	};
}

/**
 * Make both sides' republished variants of one snapshot under `outDir` (`base/runtime.json`,
 * `head/runtime.json`) and return the classification (`republish.json`): `copies` (baked defs that
 * are copies of the published engine's built-ins — `publishedBuiltinsFile`, else main's),
 * `authored` (kept as baked), `changed` (ids the two variants disagree on), `affected` and
 * `classifiedAgainst`. Deterministic in its inputs, so the plan and every render shard compute the
 * same variants.
 */
export function republishVariants({
	bundleFile,
	baseBuiltinsFile,
	headBuiltinsFile,
	publishedBuiltinsFile,
	outDir,
}) {
	mkdirSync(outDir, { recursive: true });
	republishCli(ROOT, [
		'variants',
		'--bundle',
		resolve(bundleFile),
		'--base-builtins',
		resolve(baseBuiltinsFile),
		'--head-builtins',
		resolve(headBuiltinsFile),
		...(publishedBuiltinsFile ? ['--published-builtins', resolve(publishedBuiltinsFile)] : []),
		'--out',
		resolve(outDir),
	]);
	return JSON.parse(readFileSync(join(outDir, 'republish.json'), 'utf8'));
}
