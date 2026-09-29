// Dependency-free on purpose, like `deliveryProfile.js` beside it: `scripts/build-delivery.mjs`
// imports it to describe a build it only packages, and importing `index.js` would run
// sveltekit()/lingui() first.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The engine checkout this module ships in — in a game repo, the `engine/` submodule. */
const ENGINE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Written beside the built game by whoever cut it, and read back by the packager. */
export const BUILD_INFO_FILE = 'build-info.json';

const gitHead = (cwd) => {
	const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
	return result.status === 0 ? result.stdout.trim() : '';
};

/**
 * The lockfile the build actually installed from, hashed — found by walking up from the game root,
 * so a game repo answers with its own and the engine monorepo with the workspace's.
 *
 * Computed here rather than passed in, because it is the one value a caller CANNOT know in advance:
 * a synced desktop build installs with `--no-frozen-lockfile` against an engine that just advanced,
 * so pnpm may rewrite the lockfile moments before `vite build` loads this config.
 */
export const lockfileSha256 = (from) => {
	let dir = resolve(from);
	for (;;) {
		const file = resolve(dir, 'pnpm-lock.yaml');
		if (existsSync(file)) return createHash('sha256').update(readFileSync(file)).digest('hex');
		const up = dirname(dir);
		if (up === dir) return '';
		dir = up;
	}
};

let cached;

/**
 * Where a build came from: enough to rebuild it, or to tell two builds apart that print the same
 * version.
 *
 * The version and the time are the caller's (the desktop launcher numbers its builds and registers
 * the same pair to the portal). The two commits prefer the caller's word too — the launcher reads
 * them after it has advanced the submodule, which is the state that matters — and otherwise ask git.
 * `engineSha` is the engine actually compiled, NOT the game repo's recorded pin: every desktop build
 * advances the submodule past it on purpose. In the engine monorepo both commits are the same one.
 *
 * Memoised per process: the define and the packager must agree, and SvelteKit loads the config
 * more than once.
 */
export const buildProvenance = (gameRoot = process.cwd()) => {
	cached ??= {
		version: process.env.PUBLIC_BUILD_VERSION ?? '',
		builtAt: process.env.PUBLIC_BUILD_TIME || new Date().toISOString(),
		engineSha: process.env.PUBLIC_BUILD_ENGINE_SHA || gitHead(ENGINE_ROOT),
		gameSha: process.env.PUBLIC_BUILD_GAME_SHA || gitHead(gameRoot),
		lockfileSha256: lockfileSha256(gameRoot),
		launcherVersion: process.env.PUBLIC_BUILD_LAUNCHER_VERSION ?? '',
	};
	return cached;
};
