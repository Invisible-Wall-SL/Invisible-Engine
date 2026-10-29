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
 * The rules:
 *  - a third-party package `apps/lines/package.json` declares (dependencies and devDependencies,
 *    both copied) must be one game repos already carry ({@link SCAFFOLD_EXTERNALS});
 *  - every `workspace:` dependency, of `apps/lines` and of every workspace package it reaches, must
 *    live under `packages/`, the only engine folder a game repo's workspace includes;
 *  - every package `apps/lines/src` imports must be one `apps/lines` declares;
 *  - a family-only package ({@link FAMILY_ONLY}: `engine-rooms`) is reached only through its
 *    family's seam module, so a runtime built without the family carries none of it
 *    (`docs/design/phase-11.md` §2.4).
 *
 * Third-party VERSIONS are not compared: Svelte's are `config-vite`'s guard; the others a game repo
 * keeps at its scaffold-day pins.
 *
 *   node scripts/check-game-app-deps.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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

/** Workspace packages only one family uses: each is imported only behind that family's seam (paths
 *  relative to apps/lines/src; `behind` lists every module that may import the package or reach a
 *  module that does). */
const FAMILY_ONLY = {
	'engine-rooms': {
		seam: 'families/arcade.ts',
		behind: ['game/online.ts', 'components/ArcadeStage.svelte'],
	},
};

/** The file a relative import names, as Vite resolves the extensions apps/lines omits. */
const resolveRelative = (from, spec) => {
	const base = resolve(dirname(from), spec);
	return [base, `${base}.ts`, `${base}.js`, join(base, 'index.ts')].find(
		(f) => existsSync(f) && !statSync(f).isDirectory(),
	);
};

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const depsOf = (pkg) => ({ ...pkg.devDependencies, ...pkg.dependencies, ...pkg.peerDependencies });
const isWorkspace = (spec) => String(spec).startsWith('workspace:');

const workspacePackages = new Map(
	readdirSync(join(ROOT, 'packages'))
		.map((dir) => join(ROOT, 'packages', dir, 'package.json'))
		.filter(existsSync)
		.map((file) => [readJson(file).name, readJson(file)]),
);

const app = readJson(join(ROOT, 'apps', 'lines', 'package.json'));
const declared = { ...app.devDependencies, ...app.dependencies };

const problems = [];
const outsidePackages = (name, from) =>
	`"${name}" (a workspace dependency of ${from}) is not a package under packages/ — a game ` +
	`repo's workspace includes only engine/packages/*, so its whole install fails.`;

for (const [name, spec] of Object.entries(declared)) {
	if (isWorkspace(spec)) {
		if (!workspacePackages.has(name)) problems.push(outsidePackages(name, 'apps/lines'));
	} else if (!SCAFFOLD_EXTERNALS.has(name)) {
		problems.push(
			`"${name}": "${spec}" is a third-party package game repos do not declare, so every ` +
				`game repo's build fails to resolve it. Declare it in a workspace package under ` +
				`packages/ and import that instead (docs/design/games-deploy.md).`,
		);
	}
}

// Every workspace package a game repo installs, through any edge, must be under packages/ too.
const closure = new Set();
const queue = Object.keys(declared).filter(
	(n) => isWorkspace(declared[n]) && workspacePackages.has(n),
);
while (queue.length) {
	const name = queue.pop();
	if (closure.has(name)) continue;
	closure.add(name);
	for (const [dep, spec] of Object.entries(depsOf(workspacePackages.get(name)))) {
		if (!isWorkspace(spec)) continue;
		if (workspacePackages.has(dep)) queue.push(dep);
		else problems.push(outsidePackages(dep, `packages/…/${name}`));
	}
}

// The game layer's own imports must be ones apps/lines declares: an import the monorepo root
// happens to provide resolves here and nowhere else.
const srcDir = join(ROOT, 'apps', 'lines', 'src');
const sources = [];
const walk = (dir) => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walk(path);
		else if (/\.(ts|js|mjs|svelte)$/.test(entry.name)) sources.push(path);
	}
};
walk(srcDir);
/** `import … from '<spec>'` (multi-line), `import '<spec>'` and `import('<spec>')`; comments never
 *  start a line with `import`, and `export … from` re-exports are matched like imports. */
const IMPORT =
	/^\s*(?:import|export)\b[^'"]*?\bfrom\s*(['"])([^'"\n]+)\1|^\s*import\s*(['"])([^'"\n]+)\3|\bimport\(\s*(['"])([^'"\n]+)\5\s*\)/gm;
const PACKAGE = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;
const imported = new Map();
for (const file of sources) {
	for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
		const spec = m[2] ?? m[4] ?? m[6];
		if (/^[./$~]|^node:|^virtual:/.test(spec)) continue;
		const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
		if (!PACKAGE.test(name)) continue;
		if (!imported.has(name)) imported.set(name, relative(ROOT, file));
	}
}
for (const [name, file] of imported) {
	if (!(name in declared)) {
		problems.push(
			`${file} imports "${name}", which apps/lines/package.json does not declare — it resolves ` +
				`in the monorepo through the root install, never in a game repo.`,
		);
	}
}

// A family-only package is reachable only through its family's seam (`families/<family>.ts`), so a
// build that leaves the family out (`config-vite`'s seam stub) really leaves the package out. Its
// importers must be among the seam's modules, and those are imported only by the seam or by each
// other (paths relative to apps/lines/src).
for (const [name, { seam, behind }] of Object.entries(FAMILY_ONLY)) {
	const inside = new Set([seam, ...behind].map((p) => join(srcDir, p)));
	for (const file of inside) {
		if (!existsSync(file)) problems.push(`${relative(ROOT, file)} (${name}'s seam) does not exist`);
	}
	for (const [pkg, json] of workspacePackages) {
		if (name in depsOf(json))
			problems.push(`packages/…/${pkg} depends on "${name}", which only ${seam} may reach`);
	}
	for (const file of sources) {
		const rel = relative(ROOT, file);
		for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
			const spec = m[2] ?? m[4] ?? m[6];
			if (
				(spec === name || spec.startsWith(`${name}/`)) &&
				!behind.includes(relative(srcDir, file))
			)
				problems.push(
					`${rel} imports "${name}", which only the ${seam} seam's modules may: a build ` +
						`without that family would still carry it.`,
				);
			const target = spec.startsWith('.') ? resolveRelative(file, spec) : null;
			if (target && behind.includes(relative(srcDir, target)) && !inside.has(file))
				problems.push(
					`${rel} imports ${relative(ROOT, target)}, which carries "${name}": import it only ` +
						`through ${seam}, so a build without that family leaves it out.`,
				);
		}
	}
}

// Inputs this small mean the scan read the wrong thing, not that everything is fine.
if (Object.keys(declared).length < 20) problems.push('apps/lines declares under 20 dependencies');
if (closure.size < 10)
	problems.push(`only ${closure.size} workspace packages reached from apps/lines`);
if (imported.size < 10) problems.push(`only ${imported.size} packages imported by apps/lines/src`);

if (problems.length) {
	console.error(`✗ apps/lines dependencies:\n  - ${problems.join('\n  - ')}`);
	process.exit(1);
}
console.log(
	`✓ apps/lines: ${Object.keys(declared).length} declared dependencies, ${closure.size} workspace ` +
		`packages and ${imported.size} imported packages, all under packages/ or carried by game repos`,
);
