// Where every Rigger spike gets the Spine runtime. Resolved the way the game gets it — from
// `packages/pixi-svelte`, which pins it — and refused unless it is 4.2.x:
//
//   import { SPINE_CORE } from './spine.mjs';
//   const { SkeletonJson, … } = await import(SPINE_CORE);
//
// WHY 4.2 ONLY: a Spine runtime reads exactly one editor version's data. Every exported skeleton and
// the Rigger's `.irig` are Spine 4.2 JSON, so a spike that loads them through a 4.3 runtime is not
// checking what ships. The spikes used to hard-code `.pnpm/@esotericsoftware+spine-core@4.2.74/…`,
// which failed a Dependabot 4.3 bump only by accident (ERR_MODULE_NOT_FOUND); this fails it on
// purpose, and keeps working across 4.2.x patches. See `.github/dependabot.yml`.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED = /^4\.2\.\d+$/;

/**
 * `name`'s entry file and package dir. A git worktree has no node_modules of its own until someone
 * installs in it, so each ancestor checkout's `packages/pixi-svelte` is tried in turn.
 */
function resolvePackage(name) {
	for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
		const anchor = join(dir, 'packages', 'pixi-svelte', 'package.json');
		if (existsSync(anchor)) {
			let entry = null;
			try {
				entry = createRequire(anchor).resolve(name);
			} catch {}
			if (entry) {
				let pkgDir = dirname(entry);
				while (!existsSync(join(pkgDir, 'package.json'))) pkgDir = dirname(pkgDir);
				return { entry, pkgDir };
			}
		}
		if (dirname(dir) === dir) {
			console.error(`✗ ${name} not found from any packages/pixi-svelte — run pnpm install`);
			process.exit(1);
		}
	}
}

function spinePackage(name) {
	const found = resolvePackage(name);
	const { version } = JSON.parse(readFileSync(join(found.pkgDir, 'package.json'), 'utf8'));
	if (!REQUIRED.test(version)) {
		console.error(
			`✗ ${name} ${version} found, spikes require 4.2.x — the runtime must match the Spine ` +
				`4.2 data we export (see .github/dependabot.yml)`,
		);
		process.exit(1);
	}
	return found;
}

/** spine-core's entry, as a file URL for `import()`. */
export const SPINE_CORE = pathToFileURL(spinePackage('@esotericsoftware/spine-core').entry).href;

/** A file inside the spine-pixi-v8 package, e.g. `dist/Spine.js`, as a file URL. */
export const spinePixiFile = (sub) =>
	pathToFileURL(join(spinePackage('@esotericsoftware/spine-pixi-v8').pkgDir, sub));
