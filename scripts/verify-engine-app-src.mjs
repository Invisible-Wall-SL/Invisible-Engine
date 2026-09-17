#!/usr/bin/env node
/**
 * Verify the rule that keeps EVERY game on the latest engine: a standalone game repo has no
 * application source of its own and builds `engine/apps/lines/src` straight out of the
 * submodule, while an engine app keeps building its own `src/`.
 *
 * Asserted over the REAL `packages/config-svelte/appSrc.js` — the module `config-svelte`,
 * `bake-editor-doc.mjs` and `publish-symbol-defaults.mjs` all read the answer from. It needs no
 * install (the module is node-builtins only), which is the point: this is the one decision that,
 * if it silently flipped, would put every desktop build back on a frozen copy of the game layer
 * without failing anything.
 *
 *   node scripts/verify-engine-app-src.mjs
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	ENGINE_APP_SRC,
	ENGINE_ROOT,
	appSrcDir,
	isStandaloneGame,
} from '../packages/config-svelte/appSrc.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
const ok = (label, cond, detail = '') => {
	checks += 1;
	if (cond) return;
	failures += 1;
	console.error(`✗ ${label}${detail ? `\n    ${detail}` : ''}`);
};

/** Run `fn` with the process cwd temporarily set to `dir`. */
const at = (dir, fn) => {
	const previous = process.cwd();
	process.chdir(dir);
	try {
		return fn();
	} finally {
		process.chdir(previous);
	}
};

// --- the engine checkout resolves to this repo ------------------------------------------------
ok('ENGINE_ROOT is this repo', ENGINE_ROOT === REPO, `${ENGINE_ROOT} !== ${REPO}`);
ok(
	'ENGINE_APP_SRC is apps/lines/src',
	ENGINE_APP_SRC === join(REPO, 'apps', 'lines', 'src'),
	ENGINE_APP_SRC,
);

// --- the paths config-svelte hands SvelteKit must EXIST ----------------------------------------
// `kit.files` pointing at a missing routes dir does not fail loudly — it builds an empty site.
for (const [label, rel] of [
	['routes', 'routes'],
	['appTemplate', 'app.html'],
	['hooks.server', 'hooks.server.ts'],
]) {
	ok(
		`engine app source has ${label}`,
		existsSync(join(ENGINE_APP_SRC, rel)),
		join(ENGINE_APP_SRC, rel),
	);
}

// --- an ENGINE app builds its own src ----------------------------------------------------------
// Every directory inside the checkout, including the packages a game repo's `build:engine` step
// compiles from `<game>/engine/packages/*`, must keep SvelteKit's defaults.
for (const dir of [
	REPO,
	join(REPO, 'apps', 'lines'),
	join(REPO, 'packages', 'components-layout'),
]) {
	at(dir, () => {
		ok(`not standalone inside the engine: ${dir}`, !isStandaloneGame());
		ok(`engine app compiles its own src: ${dir}`, appSrcDir() === join(dir, 'src'), appSrcDir());
	});
}

// --- a STANDALONE game repo builds the engine's src --------------------------------------------
// The game repo is the PARENT of the engine checkout in the real layout (`<game>/engine`), so the
// nearest possible outside-dir is the sharpest test of the containment check: a naive
// `startsWith` on the path string would call `…/Invisible Engine` a child of `…/Invisible` and
// silently put the game back on its own stale copy.
const gameRepo = dirname(REPO);
at(gameRepo, () => {
	ok('a game repo is standalone', isStandaloneGame(), gameRepo);
	ok('a game repo compiles the engine app src', appSrcDir() === ENGINE_APP_SRC, appSrcDir());
});

console.log(
	failures === 0
		? `✓ engine app source: ${checks} assertions passed — a game repo builds ${ENGINE_APP_SRC}`
		: `✗ engine app source: ${failures}/${checks} assertions FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
