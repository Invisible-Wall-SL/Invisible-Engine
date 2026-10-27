#!/usr/bin/env node
/**
 * Fail when the shared game app (`apps/lines`) declares a dependency a standalone game repo cannot
 * install:
 *   pnpm check:game-app-deps
 *
 * A game repo compiles `engine/apps/lines/src` out of its submodule but installs from its OWN root
 * `package.json`, which `scripts/new-game.mjs` copied from `apps/lines/package.json` once, on
 * scaffold day (`docs/design/games-deploy.md`). The desktop launcher's ☁ Publish / 📦 Deliver
 * declare any ENGINE WORKSPACE package the repo predates, and align the Svelte pins, before every
 * build. Nothing adds a third-party package. So when #1375 added `@colyseus/sdk` to `apps/lines`
 * directly, every game repo's next publish died on `Rollup failed to resolve import
 * "@colyseus/sdk"`, though no game uses it. The fix was `packages/engine-rooms`: a workspace
 * package that carries the dependency itself.
 *
 * The rules, over `apps/lines/package.json` (dependencies and devDependencies alike, since both
 * were copied):
 *  - a third-party package must be one game repos already carry ({@link SCAFFOLD_EXTERNALS}). A
 *    new one goes in a workspace package under `packages/`;
 *  - a `workspace:` dependency must live under `packages/`, the only engine folder a game repo's
 *    workspace (`engine/packages/*`) includes.
 *
 *   node scripts/check-game-app-deps.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The third-party packages `apps/lines` declared on 2026-10-27, which game repos copied at
 *  scaffold. Never grow this list: a repo scaffolded before the addition would not have it. */
const SCAFFOLD_EXTERNALS = new Set([
	'lodash',
	'@types/lodash',
	'svelte',
	'vite',
	'@sveltejs/kit',
	'@lingui/core',
	'eslint',
	'chromatic',
	'@storybook/addon-svelte-csf',
	'@sveltejs/vite-plugin-svelte',
	'cross-env',
	'svelte-check',
]);

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const workspacePackages = new Map(
	readdirSync(join(ROOT, 'packages'))
		.map((dir) => join(ROOT, 'packages', dir, 'package.json'))
		.filter(existsSync)
		.map((file) => [readJson(file).name, file]),
);

const app = readJson(join(ROOT, 'apps', 'lines', 'package.json'));
const declared = { ...app.devDependencies, ...app.dependencies };

const problems = [];
for (const [name, spec] of Object.entries(declared)) {
	if (String(spec).startsWith('workspace:')) {
		if (!workspacePackages.has(name)) {
			problems.push(
				`"${name}" is a workspace dependency but not a package under packages/ — a game ` +
					`repo's workspace includes only engine/packages/*, so it cannot install it.`,
			);
		}
	} else if (!SCAFFOLD_EXTERNALS.has(name)) {
		problems.push(
			`"${name}": "${spec}" is a third-party package game repos do not declare, so every ` +
				`game repo's build fails to resolve it. Declare it in a workspace package under ` +
				`packages/ (as packages/engine-rooms carries @colyseus/sdk) and import that instead.`,
		);
	}
}

if (problems.length) {
	console.error(`✗ apps/lines/package.json:\n  - ${problems.join('\n  - ')}`);
	process.exit(1);
}
console.log(
	`✓ apps/lines declares ${Object.keys(declared).length} dependencies, all installable in a game repo`,
);
