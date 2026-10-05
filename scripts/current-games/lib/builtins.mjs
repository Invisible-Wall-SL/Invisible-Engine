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
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
 * extraction, this repo for the variants.
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
		{ cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
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
			join(checkout, BUILTIN_DEFS_SOURCE),
			'--out',
			outFile,
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

/**
 * Make both sides' republished variants of one snapshot under `outDir` (`base/runtime.json`,
 * `head/runtime.json`) and return the classification (`republish.json`): `copies` (baked defs that
 * are copies of main's built-ins), `authored` (kept as baked), `changed` (ids the two variants
 * disagree on) and `affected`. Deterministic in its inputs, so the plan and every render shard
 * compute the same variants.
 */
export function republishVariants({ bundleFile, baseBuiltinsFile, headBuiltinsFile, outDir }) {
	mkdirSync(outDir, { recursive: true });
	republishCli(ROOT, [
		'variants',
		'--bundle',
		bundleFile,
		'--base-builtins',
		baseBuiltinsFile,
		'--head-builtins',
		headBuiltinsFile,
		'--out',
		outDir,
	]);
	return JSON.parse(readFileSync(join(outDir, 'republish.json'), 'utf8'));
}
