// Offline fixture for the SCAFFOLD TEMPLATE — does `new-game.mjs` still describe THIS engine?
//
//   node scripts/verify-scaffold-template.mjs
//
// WHAT IT PROVES. `scripts/new-game.mjs` generates a game repo: a `package.json` full of
// engine dependencies, a `tsconfig.json` that reaches into the engine, and the game's own
// source seeded from a reference app. Nothing tied any of that to the engine it names, so
// the template rotted in place — twice, silently, and both only surfaced as a build failure
// on a user's machine:
//
//   1. #533 (2026-09-01) deleted `packages/config-ts` and moved the shared compiler options
//      to `tsconfig.base.json` at the repo root. `apps/lines` was migrated; the scaffolder
//      was not, so every game it made asked for a package that no longer existed:
//        ERR_PNPM_WORKSPACE_PKG_NOT_FOUND  "config-ts@workspace:*" … no package named
//        "config-ts" is present in the workspace
//   2. The hand-maintained arrays of engine package names never gained `engine-game` or
//      `game-config`, so once the scaffold started seeding real game source, that source
//      could not resolve its own imports:
//        [vite]: Rollup failed to resolve import "engine-game" from src/components/Game.svelte
//
// Both have the same root cause: a COPY of another package's dependency list, with no way to
// notice the original changed. The fix was to stop copying — the scaffolder now reads
// `apps/<SEED_APP>/package.json` at run time — and these claims are what keep it that way.
//
// This is a SOURCE assertion, not an execution: `new-game.mjs` is a CLI with top-level side
// effects (it exits without `--name`, and clones a submodule), so it cannot be imported.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLF } from './lib/read-lf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readLF(join(ROOT, 'scripts', 'new-game.mjs'));

let checks = 0;
const fail = (msg) => {
	console.error(`\n✗ ${msg}\n`);
	process.exit(1);
};
const ok = (label, cond, detail = '') => {
	if (!cond) fail(`${label}${detail ? ` — ${detail}` : ''}`);
	checks++;
	console.log(`  ok ${label}`);
};

/** Every workspace package name the engine actually publishes. */
function realPackageNames() {
	const names = new Set();
	for (const group of ['packages', 'apps']) {
		const dir = join(ROOT, group);
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const pkg = join(dir, entry.name, 'package.json');
			if (!existsSync(pkg)) continue;
			try {
				const { name } = JSON.parse(readFileSync(pkg, 'utf8'));
				if (name) names.add(name);
			} catch {
				/* an unparseable package.json is not this fixture's business */
			}
		}
	}
	return names;
}

console.log('1. the scaffold DERIVES its dependencies instead of hand-listing them');
const real = realPackageNames();
ok('the engine exposes a plausible number of workspace packages', real.size > 20, `${real.size}`);
ok(
	'no hand-maintained package-name array has crept back',
	!/const ENGINE_(PACKAGES|CONFIGS) = \[/.test(src),
	'name the seed app as the source of truth; do not re-copy its dependency list',
);
ok('it reads the seed app manifest at run time', src.includes('seedAppManifest'));

console.log('2. the seed app — which IS the dependency list now — is coherent');
const seedApp = (/const SEED_APP = '([^']+)'/.exec(src) || [])[1];
ok('the scaffolder names a seed app', Boolean(seedApp), 'SEED_APP not found');
// Must equal the bundle id `runtimeFor()` returns in publishGame.ts. A standalone build and
// the shared runtime bundle are meant to be the SAME code; if these drift, "publish it
// online" and "publish a fixed build" quietly stop being two views of one game.
ok(`it is the shared runtime's app (${seedApp})`, seedApp === 'lines');

const seedPkgPath = join(ROOT, 'apps', seedApp, 'package.json');
ok(`apps/${seedApp}/package.json exists`, existsSync(seedPkgPath));
const seedPkg = JSON.parse(readFileSync(seedPkgPath, 'utf8'));
const seedDeps = { ...(seedPkg.dependencies ?? {}), ...(seedPkg.devDependencies ?? {}) };
const workspaceDeps = Object.entries(seedDeps)
	.filter(([, v]) => String(v).startsWith('workspace:'))
	.map(([k]) => k);
ok(
	'it derives a plausible number of workspace deps',
	workspaceDeps.length > 10,
	`${workspaceDeps.length}`,
);

const missing = workspaceDeps.filter((p) => !real.has(p));
ok(
	'every workspace dep the seeded game declares resolves to a real package',
	missing.length === 0,
	`a scaffolded game would fail pnpm install on: ${missing.join(', ')}`,
);

// A seed that copies nothing puts back the placeholder repo this all exists to prevent.
for (const dir of ['src', 'static']) {
	ok(`apps/${seedApp}/${dir} exists to seed from`, existsSync(join(ROOT, 'apps', seedApp, dir)));
}

console.log('3. the tsconfig it writes extends a path that resolves');
const ext = /extends: '([^']+)'/.exec(src);
ok('the template declares a tsconfig extends target', Boolean(ext), 'none found');
const target = ext[1];
ok(
	`the extends target is a relative path into the engine, not a package name (${target})`,
	target.startsWith('./') || target.startsWith('../'),
	'a bare specifier resolves through node_modules, so deleting the package that owns it ' +
		'breaks the build — which is how config-ts failed',
);
// A scaffolded game sits one level ABOVE the engine, which it vendors at `engine/`. So the
// path it writes, with that prefix stripped, must exist here in the engine repo.
const enginePath = target.replace(/^\.\/engine\//, '');
ok(
	`it resolves to a real file in this engine (${enginePath})`,
	existsSync(join(ROOT, enginePath)),
	'vite:esbuild fails the build outright on an unresolvable extends',
);

console.log('4. the specific regression: the deleted config-ts package is never referenced');
// Matches how a REAL reference is written — a single-quoted specifier, either a dependency
// entry or an extends target (`'config-ts/base.json'`). A blanket `includes('config-ts')`
// would also forbid the comment explaining why it is gone, which is the one mention worth
// keeping: it stops someone re-adding it from muscle memory.
ok(
	'no single-quoted config-ts specifier survives',
	!src.includes("'config-ts"),
	'a scaffolded game would fail pnpm install, or its build on an unresolvable extends',
);

console.log(`\nPASS — ${checks} checks.`);
